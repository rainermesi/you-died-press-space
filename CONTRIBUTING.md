# Contributing

Thanks for helping improve Rebirth Odds.

## Easiest contribution: add a country pack

1. Read [`data/README.md`](data/README.md) for the schema.
2. Copy [`data/countries/EST.json`](data/countries/EST.json) to `data/countries/XYZ.json`.
3. Replace stats; keep **cause / stratum IDs** from [`data/vocab.json`](data/vocab.json).
4. Register the pack in [`data/catalog.json`](data/catalog.json).
5. Cite sources in the pack’s `sources` array.
6. Open a PR.

## Life-path stories (recommended for narrative work)

For randomized, stats-grounded life stories, fill out
[`data/life-paths/TEMPLATE.life-path.yaml`](data/life-paths/TEMPLATE.life-path.yaml)
and follow [`data/life-paths/README.md`](data/life-paths/README.md).
You can hand the completed YAML to an LLM using the built-in `llm_brief`.

## Architecture (short)

- **World view** picks a country by population (`data/world.json`).
- If that country has a pack in `catalog.json`, the **country pack** roller runs.
- Otherwise the **fallback** illustrative model runs (`data/fallback.json`).
- Shared labels live in `vocab.json`; sampling knobs in `engine.json`.

Country-specific published rates belong in the country file. Shared IDs and engine parameters belong in vocab/engine — reference them, don’t duplicate labels.
