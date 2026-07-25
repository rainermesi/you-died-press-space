/* Rebirth Odds — data loader + roll model
   World mode uses a country pack when catalog lists one; otherwise fallback. */
(function (global) {
  const DATA_ROOT = "data";

  const state = {
    ready: false,
    catalog: null,
    vocab: null,
    engine: null,
    world: null,
    fallback: null,
    packs: Object.create(null), // iso3 -> pack
    lifePaths: Object.create(null), // iso3 -> life-path spec
  };

  function weightedChoice(items) {
    const total = items.reduce((s, it) => s + it.weight, 0);
    if (total <= 0) return items[items.length - 1];
    let r = Math.random() * total;
    for (const it of items) {
      r -= it.weight;
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function pct(n, d) {
    return ((n / d) * 100).toFixed(2);
  }

  function causeLabel(id) {
    const entry = state.vocab?.causes?.[id];
    return entry?.label || id;
  }

  function plainCause(id) {
    const entry = state.vocab?.causes?.[id];
    return entry?.plain || entry?.label || id;
  }

  function familyPhrase(strataType, stratumId) {
    return (
      state.vocab?.strataTypes?.[strataType]?.levels?.[stratumId]?.familyPhrase ||
      `a ${stratumId} household`
    );
  }

  function storyBeat(strataType, stratumId) {
    const level = state.vocab?.strataTypes?.[strataType]?.levels?.[stratumId];
    return level?.storyBeat || `You started in ${familyPhrase(strataType, stratumId)}.`;
  }

  function pickStory(value) {
    if (Array.isArray(value)) {
      if (!value.length) return "";
      return value[Math.floor(Math.random() * value.length)];
    }
    return value || "";
  }

  function pickFromPool(pool) {
    if (!pool) return "";
    if (Array.isArray(pool)) return pickStory(pool);
    return "";
  }

  function slotOptions(slotDef, stratumId) {
    if (!slotDef) return [];
    if (Array.isArray(slotDef)) return slotDef;
    const byStratum = slotDef.byStratum?.[stratumId];
    if (byStratum?.length) return byStratum;
    if (slotDef.default?.length) return slotDef.default;
    return [];
  }

  function fillTemplate(template, slots, pools, stratumId, depth = 0) {
    if (!template || depth > 4) return template || "";
    return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
      if (slots?.[key]) {
        const chosen = pickFromPool(slotOptions(slots[key], stratumId));
        return fillTemplate(chosen, slots, pools, stratumId, depth + 1);
      }
      if (pools?.[key]) {
        return pickFromPool(pools[key]);
      }
      return `{${key}}`;
    });
  }

  function composeStageStory(bank, stageId, stratumId) {
    const stage = bank?.stages?.[stageId];
    if (!stage) return "";
    const template = pickStory(stage.templates);
    return fillTemplate(template, stage.slots, bank.pools || {}, stratumId)
      .replace(/\s+/g, " ")
      .trim();
  }

  /* -------- life-path spec (YAML → JSON) -------- */

  function lifePathFor(iso3) {
    return state.lifePaths[iso3] || null;
  }

  function pickWeightedValues(values) {
    return weightedChoice(
      values.map((v) => ({
        ...v,
        weight: v.weight == null ? 1 : Number(v.weight),
      }))
    );
  }

  function applyValueBiases(value, varIds) {
    let w = value.weight == null || value.weight === "" ? 1 : Number(value.weight);
    const biasMaps = [
      ["by_class_level", "class_level"],
      ["by_settlement", "settlement"],
      ["by_region", "region"],
      ["by_mother_nationality", "mother_nationality"],
      ["by_sex", "sex"],
    ];
    for (const [mapKey, varName] of biasMaps) {
      const table = value[mapKey];
      if (!table || typeof table !== "object") continue;
      const key = varIds[varName];
      if (key != null && table[key] != null) w *= Number(table[key]);
    }
    return w > 0 ? w : 0;
  }

  function pickFromPlaceBank(spec, regionId, settlementId) {
    const banks = spec.place_banks || {};
    const regionBank = banks[regionId] || {};
    const list =
      regionBank[settlementId] ||
      regionBank.urban ||
      regionBank.rural ||
      [];
    if (!list.length) {
      const regionVar = spec.variables?.region?.values?.find((v) => v.id === regionId);
      return {
        id: regionId || "unknown",
        label: regionVar?.label || regionId || "Estonia",
      };
    }
    return pickWeightedValues(
      list.map((p) => ({
        ...p,
        weight: p.weight == null ? 1 : Number(p.weight),
      }))
    );
  }

  function rollPlaceForVars(spec, ids, labels) {
    const place = pickFromPlaceBank(spec, ids.region, ids.settlement || "urban");
    ids.place = place.id;
    labels.place = place.label;
    ids.place_region = ids.region;
  }

  function rollOtherPlace(spec, ids) {
    const regions = Object.keys(spec.place_banks || {});
    let candidates = regions.filter((r) => r !== ids.place_region && r !== ids.region);
    if (!candidates.length) candidates = regions.filter((r) => r !== ids.region);
    if (!candidates.length) candidates = regions.slice();
    const destRegion =
      candidates[Math.floor(Math.random() * candidates.length)] || ids.region;
    // Prefer urban destinations slightly (internal migration toward towns)
    const settlement = Math.random() < 0.75 ? "urban" : "rural";
    const place = pickFromPlaceBank(spec, destRegion, settlement);
    return {
      id: place.id,
      label: place.label,
      region: destRegion,
      settlement,
    };
  }

  function rollLifePathVariables(spec) {
    const rolled = Object.create(null);
    const labels = Object.create(null);
    // Roll core facts first so dependent vars can bias
    const order = [
      "region",
      "sex",
      "class_level",
      "parents_marital_status",
      "settlement",
      "mother_age_group",
      "mother_born_in",
      "mother_nationality",
      "school_marks",
    ];
    const seen = new Set();
    const rollOne = (name) => {
      if (seen.has(name)) return;
      const def = spec.variables?.[name];
      if (!def?.values?.length) return;
      seen.add(name);
      const pickable = def.values
        .map((v) => ({
          ...v,
          weight: applyValueBiases(v, rolled),
        }))
        .filter((v) => v.weight > 0);
      if (!pickable.length) return;
      const chosen = pickWeightedValues(pickable);
      rolled[name] = chosen.id;
      labels[name] = chosen.label;
      if (name === "class_level" && chosen.pack_stratum_id) {
        rolled.pack_stratum_id = chosen.pack_stratum_id;
      }
    };
    for (const name of order) rollOne(name);
    for (const name of Object.keys(spec.variables || {})) rollOne(name);

    rollPlaceForVars(spec, rolled, labels);
    return { ids: rolled, labels };
  }

  function sampleBeatAge(ageDef, beatId) {
    if (ageDef == null) return 0;
    if (typeof ageDef === "number") return ageDef;
    const min = Number(ageDef.min);
    const max = Number(ageDef.max);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return 0;
    const raw = min + Math.floor(Math.random() * (max - min + 1));
    // Midlife template uses "{age}s" → decade bucket (40s, 50s)
    if (beatId === "midlife") return Math.floor(raw / 10) * 10;
    return raw;
  }

  function poolItemWeight(item, varIds) {
    return applyValueBiases(
      { ...item, weight: item.weight == null ? 1 : Number(item.weight) },
      varIds
    );
  }

  function pickPoolEvent(poolItems, varIds) {
    if (!poolItems?.length) return null;
    const weighted = poolItems
      .map((item) => ({ item, weight: poolItemWeight(item, varIds) }))
      .filter((row) => row.weight > 0);
    if (!weighted.length) return null;
    return weightedChoice(weighted).item;
  }

  function resolveSlotValue(slotDef, ctx) {
    if (!slotDef || typeof slotDef !== "object") return "";
    if (slotDef.literal != null) return String(slotDef.literal);
    if (slotDef.literal_from) {
      const path = String(slotDef.literal_from).split(".");
      let cur = ctx.spec;
      for (const part of path) cur = cur?.[part];
      return cur == null ? "" : String(cur);
    }
    if (slotDef.from === "beat_age") return String(ctx.beatAge);
    if (slotDef.from === "place_bank") {
      if (slotDef.different_region) {
        const dest = rollOtherPlace(ctx.spec, ctx.ids);
        // Persist destination so later beats can use the new home
        ctx.ids.place_to = dest.id;
        ctx.labels.place_to = dest.label;
        ctx.ids.place = dest.id;
        ctx.labels.place = dest.label;
        ctx.ids.place_region = dest.region;
        ctx.ids.region = dest.region;
        ctx.labels.region =
          ctx.spec.variables?.region?.values?.find((v) => v.id === dest.region)
            ?.label || dest.region;
        if (dest.settlement) {
          ctx.ids.settlement = dest.settlement;
          ctx.labels.settlement =
            ctx.spec.variables?.settlement?.values?.find(
              (v) => v.id === dest.settlement
            )?.label || dest.settlement;
        }
        return dest.label;
      }
      // Default: current home place
      if (ctx.labels.place) return ctx.labels.place;
      const place = pickFromPlaceBank(
        ctx.spec,
        ctx.ids.region,
        ctx.ids.settlement || "urban"
      );
      ctx.ids.place = place.id;
      ctx.labels.place = place.label;
      return place.label;
    }
    if (slotDef.variable) {
      return ctx.labels[slotDef.variable] || ctx.ids[slotDef.variable] || "";
    }
    if (slotDef.pool) {
      const items = ctx.spec.pools?.[slotDef.pool] || [];
      const event = pickPoolEvent(items, ctx.ids);
      if (!event) return "";
      ctx.lastPoolEvent = event;
      // Fill left-to-right so {place} (origin) resolves before {place_to} overwrites home
      return fillLifePathTemplate(event.text || "", event.extra_slots || {}, ctx, true);
    }
    return "";
  }

  function fillLifePathTemplate(template, slots, ctx, slotsAreExtras = false) {
    if (!template) return "";
    return String(template)
      .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => {
        if (slotsAreExtras) {
          // When filling a pool fragment, prefer extra slot defs, then variables
          if (slots?.[key]) return resolveSlotValue(slots[key], ctx);
          if (ctx.labels[key] != null) return ctx.labels[key];
          if (key === "age") return String(ctx.beatAge);
          if (key === "country_name") return ctx.spec.meta?.country_name || "";
          return `{${key}}`;
        }
        const slotDef = slots?.[key];
        if (slotDef) return resolveSlotValue(slotDef, ctx);
        if (ctx.labels[key] != null) return ctx.labels[key];
        if (key === "age") return String(ctx.beatAge);
        if (key === "country_name") return ctx.spec.meta?.country_name || "";
        return `{${key}}`;
      })
      .replace(/\s+/g, " ")
      .trim();
  }

  function composeLifePathFromSpec(outcome, spec) {
    const vars = outcome.lifePathVars || rollLifePathVariables(spec);
    // Clone so move events can mutate place without corrupting the roll snapshot
    const ids = { ...vars.ids };
    const labels = { ...vars.labels };
    const ctx = {
      spec,
      ids,
      labels,
      beatAge: 0,
      lastPoolEvent: null,
    };

    const stages = [];
    let prevAge = -1;
    for (const beat of spec.beats || []) {
      let age;
      if (beat.age != null && typeof beat.age === "object") {
        const rangeMin = Number(beat.age.min);
        const rangeMax = Number(beat.age.max);
        const min = Math.max(rangeMin, prevAge + 1);
        if (!Number.isFinite(min) || !Number.isFinite(rangeMax) || min > rangeMax) {
          continue;
        }
        age = min + Math.floor(Math.random() * (rangeMax - min + 1));
        if (beat.id === "midlife") age = Math.floor(age / 10) * 10;
        // Decade flooring can collapse below prevAge — bump if needed
        if (age <= prevAge) age = Math.min(rangeMax, prevAge + 1);
      } else {
        age = sampleBeatAge(beat.age, beat.id);
        if (beat.id !== "birth" && age <= prevAge) age = prevAge + 1;
      }

      // Truncate: keep birth always (handled by buildLifePath filter); skip later beats at/after death
      if (beat.id !== "birth" && age >= outcome.age) continue;

      ctx.beatAge = age;
      ctx.lastPoolEvent = null;
      const text = fillLifePathTemplate(beat.template, beat.slots || {}, ctx);
      if (!text) continue;
      stages.push({
        age,
        label: beat.title || beat.id,
        text,
        beatId: beat.id,
      });
      prevAge = age;
    }

    return stages;
  }

  function shortLabel(strataType, stratumId) {
    return (
      state.vocab?.strataTypes?.[strataType]?.levels?.[stratumId]?.shortLabel ||
      String(stratumId).replace(/-/g, " ")
    );
  }

  function worldPop() {
    return state.world.countries.reduce((s, c) => s + c.populationMillions, 0);
  }

  function getCountry(iso3) {
    return state.world.countries.find((c) => c.iso3 === iso3) || null;
  }

  function hasPack(iso3) {
    return !!state.packs[iso3];
  }

  async function fetchJson(path) {
    const res = await fetch(`${DATA_ROOT}/${path}`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async function load() {
    const catalog = await fetchJson("catalog.json");
    const [vocab, engine, world, fallback] = await Promise.all([
      fetchJson(catalog.vocab),
      fetchJson(catalog.engine),
      fetchJson(catalog.world),
      fetchJson(catalog.fallback),
    ]);

    const packEntries = Object.entries(catalog.countries || {});
    const packs = Object.create(null);
    await Promise.all(
      packEntries.map(async ([iso3, path]) => {
        packs[iso3] = await fetchJson(path);
      })
    );

    // Prefer pack population when present
    for (const [iso3, pack] of Object.entries(packs)) {
      const row = world.countries.find((c) => c.iso3 === iso3);
      if (row && pack.populationMillions != null) {
        row.populationMillions = pack.populationMillions;
      }
    }

    // Load life-path specs referenced by country packs
    const lifePaths = Object.create(null);
    await Promise.all(
      Object.entries(packs).map(async ([iso3, pack]) => {
        if (!pack.lifePathSpec) return;
        lifePaths[iso3] = await fetchJson(pack.lifePathSpec);
      })
    );

    state.catalog = catalog;
    state.vocab = vocab;
    state.engine = engine;
    state.world = world;
    state.fallback = fallback;
    state.packs = packs;
    state.lifePaths = lifePaths;
    state.ready = true;
    return state;
  }

  function pickStratumFromShares(shares) {
    return weightedChoice(
      Object.entries(shares).map(([label, weight]) => ({ label, weight }))
    ).label;
  }

  function pickSecondary(pack, stratumId) {
    if (!pack.secondary?.givenStratum?.[stratumId]) return null;
    const row = pack.secondary.givenStratum[stratumId];
    return {
      type: pack.secondary.type,
      id: weightedChoice(
        Object.entries(row).map(([label, weight]) => ({ label, weight }))
      ).label,
    };
  }

  function samplePackAge(pack, stratumId) {
    const infant = pack.infantMortality;
    if (infant && Math.random() < infant.ratePer1000 / 1000) return 0;
    const mean = pack.lifeExpectancy.byStratum[stratumId];
    const sigma = state.engine.ageNoiseSigma.countryPack;
    const gaussian =
      (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
    return clamp(Math.round(mean + gaussian * sigma), 1, 105);
  }

  function packAgeBand(pack, age) {
    return (
      pack.causesByAge.find((b) => age >= b.minAge && age <= b.maxAge) ||
      pack.causesByAge[pack.causesByAge.length - 1]
    );
  }

  function pickPackCause(pack, age) {
    if (age <= 0 && pack.infantMortality?.causes?.length) {
      return weightedChoice(pack.infantMortality.causes.map((c) => ({ ...c }))).id;
    }
    const band = packAgeBand(pack, age);
    let id = weightedChoice(band.causes.map((c) => ({ ...c }))).id;
    const meta = state.vocab.causes[id];
    if (meta?.expandWith === "injuryDetail" && band.injuryDetail?.length) {
      id = weightedChoice(band.injuryDetail.map((c) => ({ ...c }))).id;
    }
    return id;
  }

  function rollPack(country) {
    const pack = state.packs[country.iso3];
    const stratumType = pack.strata.type;
    const spec = lifePathFor(country.iso3);
    let stratum;
    let lifePathVars = null;

    if (spec?.variables?.class_level?.values?.length) {
      // Mother's education (life-path) drives both story class and mortality stratum
      lifePathVars = rollLifePathVariables(spec);
      stratum =
        lifePathVars.ids.pack_stratum_id ||
        pickStratumFromShares(pack.strata.shares);
    } else {
      stratum = pickStratumFromShares(pack.strata.shares);
    }

    const secondary = pickSecondary(pack, stratum);
    const age = samplePackAge(pack, stratum);
    const causeId = pickPackCause(pack, age);
    return {
      mode: "pack",
      country,
      pack,
      stratumType,
      stratum,
      secondary,
      age,
      causeId,
      causeLabel: causeLabel(causeId),
      familyPhrase: familyPhrase(stratumType, stratum),
      lifePathVars,
    };
  }

  function rollFallback(country) {
    const fb = state.fallback;
    const band = country.incomeBand;
    const weights = fb.classWeightsByIncomeBand[band];
    const stratum = pickStratumFromShares(weights);
    const poverty = state.engine.fallbackPovertyIndex[stratum] ?? 0;
    const causes = fb.causesByIncomeBand[band].map((c) => ({
      id: c.id,
      weight: c.weight + (c.classPenalty ? c.classPenalty * poverty : 0),
    }));
    const causeId = weightedChoice(causes).id;

    let age;
    const early = state.engine.earlyDeathCauseIds || [];
    if (early.includes(causeId) && (causeId === "birth-complications" || causeId === "perinatal")) {
      age = Math.random() < 0.55 ? 0 : clamp(Math.round(Math.random() * 4), 1, 4);
    } else if (causeId === "malnutrition") {
      age = clamp(Math.round(1 + Math.random() * 12), 1, 14);
    } else {
      const base = fb.lifeExpectancyByIncomeBand[band];
      const shift = state.engine.fallbackClassLifeExpectancyShift[stratum] || 0;
      const sigma = state.engine.ageNoiseSigma.fallback;
      const gaussian =
        (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      age = clamp(Math.round(base + shift + gaussian * sigma), 0, 105);
    }

    return {
      mode: "fallback",
      country,
      pack: null,
      stratumType: "class",
      stratum,
      secondary: null,
      age,
      causeId,
      causeLabel: causeLabel(causeId),
      familyPhrase: familyPhrase("class", stratum),
    };
  }

  function roll(country) {
    if (hasPack(country.iso3)) return rollPack(country);
    return rollFallback(country);
  }

  function pickCountry(scope, lockedIso3) {
    if (scope === "country" && lockedIso3) {
      const locked = getCountry(lockedIso3);
      if (locked) return locked;
    }
    return weightedChoice(
      state.world.countries.map((c) => ({
        ...c,
        weight: c.populationMillions,
      }))
    );
  }

  /* -------- life path -------- */
  const CLASS_RANK = {
    underclass: 0,
    "lower working class": 1,
    "working class": 2,
    "lower middle class": 3,
    "middle class": 4,
    "upper middle class": 5,
    "upper class": 6,
  };

  function deathStage(age, causeId) {
    const plain = plainCause(causeId);
    if (age <= 0) {
      return { age: 0, label: "Death", text: `Died at birth — ${plain}.`, death: true };
    }
    if (age < 5) {
      return {
        age,
        label: "Death",
        text: `Died in early childhood at ${age} — ${plain}.`,
        death: true,
      };
    }
    return { age, label: "Death", text: `Died at ${age} — ${plain}.`, death: true };
  }

  function fallbackLifePathStages(outcome) {
    const bank = state.fallback?.storyBank;
    const income = outcome.country.incomeBand;
    const name = outcome.country.name;

    const stageText = (id, legacy) => {
      if (bank) {
        const composed = composeStageStory(bank, id, outcome.stratum);
        if (composed) return composed;
      }
      return legacy;
    };

    // Legacy illustrative blurbs kept as last-resort fill-ins
    const rank = CLASS_RANK[outcome.stratum] ?? 3;
    const poor = rank <= 1;
    const modest = rank <= 3;
    const affluent = rank >= 5;

    const childhood = {
      low: poor
        ? "Scarce food, limited clean water, and little routine medical care."
        : "Crowded household; basic needs met with frequent interruptions from illness or work.",
      "lower-middle": poor
        ? "Basic shelter and food, but school and clinics compete with household costs."
        : "Urban or peri-urban childhood with patchy public services and family support.",
      "upper-middle": modest
        ? "Public schooling and vaccinations; parents stretch income to keep you enrolled."
        : "Stable housing, regular meals, and access to local clinics and schools.",
      high: modest
        ? "Public services cover the essentials; parents work long hours to stay afloat."
        : "Secure housing, preventive care, and an expectation that childhood is for school.",
    }[income];

    const school = {
      low: poor
        ? "Leave school early — or never enroll — to help with farm, household, or informal work."
        : "A few years of primary school before work and distance cut studies short.",
      "lower-middle": poor
        ? "Primary school if nearby; secondary school is uncommon."
        : "Finish lower secondary; higher education is rare without scholarships or migration.",
      "upper-middle": modest
        ? "Complete secondary school; vocational training or short college is the usual ceiling."
        : "Secondary school plus college or technical training as the default path.",
      high: modest
        ? "Finish secondary school; further study depends on grades, loans, and family help."
        : affluent
          ? "Selective schools and university are the expected route."
          : "Secondary school and a college or apprenticeship track are typical.",
    }[income];

    const work = {
      low: poor
        ? "Informal labor, subsistence farming, or unpaid household work with irregular cash income."
        : "Low-wage informal or agricultural work; formal jobs are scarce.",
      "lower-middle": poor
        ? "Day labor, small trade, or factory/service work with little security."
        : "Wage work in services, manufacturing, or small business; savings stay thin.",
      "upper-middle": modest
        ? "Stable blue- or pink-collar work, or a small family enterprise."
        : "Skilled employment or a professional track with steadier earnings.",
      high: modest
        ? "Service, trade, or administrative work; housing and healthcare dominate the budget."
        : affluent
          ? "Professional, managerial, or capital-linked work with high security."
          : "Steady skilled or professional work in a formal labor market.",
    }[income];

    const family = {
      low: "Partner and children arrive early; extended kin share childcare and risk.",
      "lower-middle": modest
        ? "Marriage and children in the late teens or early twenties; family buffers shocks."
        : "Family formation in the twenties; one or two earners support dependents.",
      "upper-middle":
        "Partnership and children often wait until work is steadier; smaller households are common.",
      high: affluent
        ? "Later partnership, fewer children, and paid childcare or schooling support."
        : "Partnership and children usually after education or a foothold in work.",
    }[income];

    const living = {
      low: poor
        ? "Rural or dense informal housing; electricity, sanitation, and transport are unreliable."
        : "Modest dwelling with shared amenities and frequent infrastructure gaps.",
      "lower-middle":
        "Dense urban or town housing; public transit and informal markets shape daily life.",
      "upper-middle": modest
        ? "Apartment or small house in a growing city; appliances and debt are both common."
        : "Comfortable urban or suburban housing with reliable utilities.",
      high: affluent
        ? "High-amenity neighborhood; private transport and specialist care are normal."
        : "Adequate housing with reliable utilities; location trades cost against opportunity.",
    }[income];

    return [
      {
        age: 0,
        label: "Birth",
        text: `Born in ${name}. ${storyBeat(outcome.stratumType, outcome.stratum)}`,
      },
      { age: 5, label: "Early years", text: stageText("early", childhood) },
      { age: 12, label: "Schooling", text: stageText("school", school) },
      { age: 20, label: "Work", text: stageText("work", work) },
      { age: 30, label: "Family", text: stageText("family", family) },
      { age: 45, label: "Midlife", text: stageText("midlife", living) },
    ];
  }

  function packLifePathStages(outcome) {
    const pack = outcome.pack;
    const spec = lifePathFor(pack.iso3);
    if (spec?.beats?.length) {
      return composeLifePathFromSpec(outcome, spec);
    }

    const bank = pack.storyBank;
    const legacy = pack.lifePath?.[outcome.stratum];
    if (!bank && !legacy) return fallbackLifePathStages(outcome);

    const moneyBeat = outcome.secondary
      ? ` ${storyBeat(outcome.secondary.type, outcome.secondary.id)}`
      : "";

    const stageText = (id) => {
      if (bank) {
        const composed = composeStageStory(bank, id, outcome.stratum);
        if (composed) return composed;
      }
      return pickStory(legacy?.[id]);
    };

    return [
      {
        age: 0,
        label: "Birth",
        text: `Born in ${pack.name}. ${storyBeat(outcome.stratumType, outcome.stratum)}${moneyBeat}`,
      },
      { age: 5, label: "Early years", text: stageText("early") },
      { age: 12, label: "Schooling", text: stageText("school") },
      { age: 20, label: "Work", text: stageText("work") },
      { age: 30, label: "Family", text: stageText("family") },
      { age: 45, label: "Midlife", text: stageText("midlife") },
    ];
  }

  function buildLifePath(outcome) {
    if (outcome._builtPath) return outcome._builtPath;

    const stages =
      outcome.mode === "pack"
        ? packLifePathStages(outcome)
        : fallbackLifePathStages(outcome);
    const lived = stages.filter((s, i) => i === 0 || s.age < outcome.age);
    const death = deathStage(outcome.age, outcome.causeId);

    let intro;
    if (outcome.age <= 0) {
      intro =
        "This life ended at the beginning — only a few moments to tell.";
    } else if (outcome.age < 5) {
      intro =
        "This life was short. Here is what little path there was.";
    } else if (outcome.mode === "pack" && lifePathFor(outcome.country.iso3)) {
      intro = `One possible path through a life in ${outcome.country.name}. Each reroll tells a different version.`;
    } else if (outcome.mode === "pack") {
      intro = `One possible path through a life in ${outcome.country.name}. Each reroll tells a different version.`;
    } else {
      intro = `One possible path in ${outcome.country.name}. (No detailed country pack yet — this path is sketched, not curated.)`;
    }

    outcome._builtPath = { intro, stages: [...lived, death] };
    return outcome._builtPath;
  }

  function pathHeading(stage) {
    if (stage.label === "Birth" && !stage.death) return "Birth";
    if (stage.death && stage.age <= 0) return "Death · at birth";
    if (stage.death) return `Death · age ${stage.age < 1 ? "<1" : stage.age}`;
    return `${stage.label} · age ~${stage.age}`;
  }

  function aboutLines(outcome, locked) {
    const pop = worldPop();
    const chanceLine = locked
      ? `Country is locked to <b>${outcome.country.name}</b> in one-country mode.`
      : `Chance of being born in <b>${outcome.country.name}</b> if all births were equally likely across people:
         <b>${pct(outcome.country.populationMillions, pop)}%</b>`;

    if (outcome.mode === "pack") {
      const pack = outcome.pack;
      const le = pack.lifeExpectancy.byStratum[outcome.stratum];
      const share = pack.strata.shares[outcome.stratum];
      const spec = lifePathFor(outcome.country.iso3);
      const classFromBirth = spec?.variables?.class_level
        ? `Story class uses <b>mother's education at birth</b> (life-path weights), mapped to pack stratum <code>${outcome.stratum}</code>.<br/>`
        : "";
      const secondaryLine = outcome.secondary
        ? `${shortLabel(outcome.secondary.type, outcome.secondary.id)} given stratum: <b>${
            outcome.secondary.id
          }</b><br/>`
        : "";
      const infant = pack.infantMortality
        ? `Infant mortality used: <b>${pack.infantMortality.ratePer1000}</b> per 1000 live births (${pack.infantMortality.year})<br/>`
        : "";
      const regionLine =
        outcome.lifePathVars?.labels?.place != null
          ? `Home place: <b>${outcome.lifePathVars.labels.place}</b> (${
              outcome.lifePathVars.labels.region || "—"
            })<br/>`
          : outcome.lifePathVars?.labels?.region != null
            ? `Birth region: <b>${outcome.lifePathVars.labels.region}</b><br/>`
            : "";
      return `${chanceLine}<br/>
        Model: <b>${outcome.country.name} country pack</b>${
          spec ? " + life-path spec" : ""
        }<br/>
        ${regionLine}
        ${outcome.stratumType}: <b>${shortLabel(outcome.stratumType, outcome.stratum)}</b>
        (adult pack share ≈ ${share})<br/>
        ${classFromBirth}
        ${secondaryLine}
        Life expectancy at birth for this stratum: <b>${le}</b> (${pack.lifeExpectancy.year})<br/>
        ${infant}
        Cause sampled from pack rates (vocab id <code>${outcome.causeId}</code>).<br/>
        <span style="opacity:.8">Notes: Illustrative sampling from published aggregates, not a prediction for any real person.</span>`;
    }

    return `${chanceLine}<br/>
      Model: <b>illustrative fallback</b><br/>
      Country income band: <b>${outcome.country.incomeBand}</b><br/>
      Household class drawn: <b>${outcome.stratum}</b><br/>
      <span style="opacity:.8">Notes: No curated pack for this country yet. Contributions welcome in <code>data/countries/</code>.</span>`;
  }

  function deathBeat(outcome) {
    const id = outcome.causeId;
    const plain = plainCause(id);
    if (id === "suicide") return "You died by suicide.";
    if (id === "violence") return "Violence ended your life.";
    if (id === "sids") return "Sudden infant death took you.";
    if (id === "injury") return "You died from an injury.";
    if (id === "accident" || id === "transport-accident") {
      return `You died in ${plain}.`;
    }
    if (id === "ill-defined") {
      return "The cause of death was never clearly recorded.";
    }
    return `You died of ${plain}.`;
  }

  function outcomeHeadline(outcome) {
    const path = buildLifePath(outcome);
    const birth = path.stages?.find((s) => s.beatId === "birth" || s.label === "Birth");
    if (birth?.text && !birth.death) return birth.text;
    return `Born in ${outcome.country.name}. ${storyBeat(
      outcome.stratumType,
      outcome.stratum
    )}`;
  }

  function outcomeSubline(outcome) {
    const cta = "Press Space for another life.";
    const { age } = outcome;
    if (age <= 0) {
      return `You did not survive birth. ${deathBeat(outcome)} ${cta}`;
    }
    if (age < 5) {
      return `You only reached age ${age}. ${deathBeat(outcome)} ${cta}`;
    }
    if (age < 18) {
      return `You lived to ${age}. ${deathBeat(outcome)} ${cta}`;
    }
    return `You lived to ${age}. ${deathBeat(outcome)} ${cta}`;
  }

  /** @deprecated use outcomeSubline */
  function deathSummary(outcome) {
    return outcomeSubline(outcome);
  }

  global.Rebirth = {
    state,
    load,
    pickCountry,
    roll,
    hasPack,
    getCountry,
    worldPop,
    buildLifePath,
    pathHeading,
    aboutLines,
    deathSummary,
    outcomeHeadline,
    outcomeSubline,
    shortLabel,
    causeLabel,
    plainCause,
    storyBeat,
    pct,
  };
})(window);
