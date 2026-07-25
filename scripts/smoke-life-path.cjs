#!/usr/bin/env node
/** Smoke-test Estonia life-path composition without a browser. */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const dataRoot = path.join(ROOT, "data");

global.fetch = async (url) => {
  const u = String(url).replace(/^data\//, "");
  const file = path.join(dataRoot, u);
  if (!fs.existsSync(file)) {
    return { ok: false, status: 404 };
  }
  const body = fs.readFileSync(file, "utf8");
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(body),
  };
};

global.window = global;
eval(fs.readFileSync(path.join(ROOT, "js/rebirth.js"), "utf8"));

(async () => {
  await global.Rebirth.load();
  const country = global.Rebirth.getCountry("EST");
  if (!country) throw new Error("EST missing from world");
  if (!global.Rebirth.state.lifePaths.EST) {
    throw new Error("EST life-path spec not loaded");
  }

  const samples = [];
  for (let i = 0; i < 20; i++) {
    const outcome = global.Rebirth.roll(country);
    outcome.age = 70;
    outcome._builtPath = null;
    const pathObj = global.Rebirth.buildLifePath(outcome);
    const headline = global.Rebirth.outcomeHeadline(outcome);
    const birth = pathObj.stages.find((s) => s.beatId === "birth");
    samples.push({ outcome, pathObj, headline, birth });
  }

  for (const s of samples) {
    if (!s.birth) throw new Error("Missing birth beat");
    if (!/Estonia/.test(s.birth.text)) {
      throw new Error("Birth missing Estonia: " + s.birth.text);
    }
    if (!/\b(a working-class|a middle-class|an upper-middle-class)\b/.test(s.birth.text)) {
      throw new Error("Birth missing class label: " + s.birth.text);
    }
    if (s.headline !== s.birth.text) {
      throw new Error(`Headline/path mismatch:\n${s.headline}\nvs\n${s.birth.text}`);
    }
    if (s.pathObj.stages.length < 4) {
      throw new Error("Expected several stages for age 70: " + s.pathObj.stages.length);
    }
  }

  const short = global.Rebirth.roll(country);
  short.age = 4;
  short._builtPath = null;
  const shortPath = global.Rebirth.buildLifePath(short);
  const labels = shortPath.stages.map((s) => s.label);
  if (labels.includes("Midlife") || labels.includes("Family")) {
    throw new Error("Short life should not include midlife/family: " + labels.join(", "));
  }
  if (!shortPath.stages.some((s) => s.death)) {
    throw new Error("Missing death stage");
  }

  // Region distribution sanity over many rolls
  const counts = Object.create(null);
  for (let i = 0; i < 2000; i++) {
    const o = global.Rebirth.roll(country);
    const r = o.lifePathVars.ids.region;
    counts[r] = (counts[r] || 0) + 1;
  }
  const tallinnShare = counts.tallinn / 2000;
  if (tallinnShare < 0.28 || tallinnShare > 0.40) {
    throw new Error(`Tallinn share off: ${tallinnShare} (expected ~0.337)`);
  }

  console.log("OK — samples, truncation, Tallinn share ≈", tallinnShare.toFixed(3));
  console.log("\nExample path:");
  for (const st of samples[0].pathObj.stages) {
    console.log(`- ${st.label} · ${st.age}: ${st.text}`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
