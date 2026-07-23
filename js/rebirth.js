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

    state.catalog = catalog;
    state.vocab = vocab;
    state.engine = engine;
    state.world = world;
    state.fallback = fallback;
    state.packs = packs;
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
    const stratum = pickStratumFromShares(pack.strata.shares);
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
    const income = outcome.country.incomeBand;
    const econClass = outcome.stratum;
    const rank = CLASS_RANK[econClass] ?? 3;
    const poor = rank <= 1;
    const modest = rank <= 3;
    const affluent = rank >= 5;
    const name = outcome.country.name;

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
      { age: 5, label: "Early years", text: childhood },
      { age: 12, label: "Schooling", text: school },
      { age: 20, label: "Work", text: work },
      { age: 30, label: "Family", text: family },
      { age: 45, label: "Midlife", text: living },
    ];
  }

  function packLifePathStages(outcome) {
    const pack = outcome.pack;
    const copy = pack.lifePath?.[outcome.stratum];
    if (!copy) return fallbackLifePathStages(outcome);

    const moneyBeat = outcome.secondary
      ? ` ${storyBeat(outcome.secondary.type, outcome.secondary.id)}`
      : "";

    return [
      {
        age: 0,
        label: "Birth",
        text: `Born in ${pack.name}. ${storyBeat(outcome.stratumType, outcome.stratum)}${moneyBeat}`,
      },
      { age: 5, label: "Early years", text: pickStory(copy.early) },
      { age: 12, label: "Schooling", text: pickStory(copy.school) },
      { age: 20, label: "Work", text: pickStory(copy.work) },
      { age: 30, label: "Family", text: pickStory(copy.family) },
      { age: 45, label: "Midlife", text: pickStory(copy.midlife) },
    ];
  }

  function buildLifePath(outcome) {
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
    } else if (outcome.mode === "pack") {
      intro = `One possible path through a life in ${outcome.country.name}. Each reroll tells a different version.`;
    } else {
      intro = `One possible path in ${outcome.country.name}. (No detailed country pack yet — this path is sketched, not curated.)`;
    }

    return { intro, stages: [...lived, death] };
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
      const secondaryLine = outcome.secondary
        ? `${shortLabel(outcome.secondary.type, outcome.secondary.id)} given stratum: <b>${
            outcome.secondary.id
          }</b><br/>`
        : "";
      const infant = pack.infantMortality
        ? `Infant mortality used: <b>${pack.infantMortality.ratePer1000}</b> per 1000 live births (${pack.infantMortality.year})<br/>`
        : "";
      return `${chanceLine}<br/>
        Model: <b>${outcome.country.name} country pack</b><br/>
        ${outcome.stratumType}: <b>${shortLabel(outcome.stratumType, outcome.stratum)}</b>
        (share ≈ ${share})<br/>
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
