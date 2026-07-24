# Country data packs

This folder is the contribution surface for real-world rebirth models.

## Layout

| File | Role |
|------|------|
| `catalog.json` | Lists shared files + which country packs exist |
| `vocab.json` | **Shared** cause IDs, stratum types, display labels |
| `engine.json` | **Shared** sampling knobs (noise, class shifts) |
| `world.json` | World country list (population + income band) |
| `fallback.json` | Illustrative model when a country has no pack |
| `countries/XXX.json` | One curated pack per ISO3 code |

**Rule of thumb**

- Put **published country statistics** in `countries/XXX.json` (rates, shares, LE).
- Put **shared labels / IDs / engine knobs** in `vocab.json` or `engine.json`.
- Do **not** invent new cause label strings in a country file — add an ID to `vocab.json`, then reference `"id": "cardiovascular"`.

## Country pack schema (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "iso3": "EST",
  "name": "Estonia",
  "updated": "YYYY-MM-DD",
  "notes": "Short caveat for players/contributors",
  "sources": [{ "id": "...", "publisher": "...", "metric": "...", "year": 2024, "url": "..." }],
  "populationMillions": 1.37,
  "incomeBand": "high",
  "strata": {
    "type": "education",
    "shares": { "below-upper-secondary": 11.2, "upper-secondary": 47.0, "tertiary": 41.8 },
    "year": 2024,
    "population": "25-64"
  },
  "lifeExpectancy": {
    "overall": 79.79,
    "byStratum": { "below-upper-secondary": 72.88, "upper-secondary": 79.27, "tertiary": 83.52 },
    "year": 2025
  },
  "secondary": {
    "type": "income-quintile",
    "givenStratum": { "tertiary": { "Q1": 14.2, "Q2": 15.7, "Q3": 16.3, "Q4": 23.2, "Q5": 30.7 } },
    "year": 2024
  },
  "infantMortality": {
    "ratePer1000": 1.26,
    "year": 2024,
    "causes": [{ "id": "perinatal", "weight": 33 }]
  },
  "causesByAge": [
    {
      "id": "65-69",
      "minAge": 65,
      "maxAge": 69,
      "causes": [{ "id": "cardiovascular", "weight": 556.17 }],
      "injuryDetail": [{ "id": "accident", "weight": 54.65 }]
    }
  ],
  "lifePath": "deprecated — prefer storyBank",
  "storyBank": {
    "schemaVersion": 1,
    "pools": {
      "city": ["Tallinn", "Tartu"]
    },
    "stages": {
      "early": {
        "templates": [
          "You grew up in {home}. {earlyHook}",
          "Home was {home}. {earlyHook}"
        ],
        "slots": {
          "home": {
            "byStratum": {
              "upper-secondary": ["a Tartu suburb", "a courtyard block in Pärnu"]
            }
          },
          "earlyHook": {
            "byStratum": {
              "upper-secondary": [
                "The family doctor knew your surname before you sat down.",
                "Homework happened at the kitchen table under a buzzing lamp."
              ]
            }
          }
        }
      }
    }
  }
}
```

### Field notes

- `strata.type` must exist under `vocab.strataTypes` (`education` preferred for SES-linked LE).
- `strata.shares` weights are relative (need not sum to 100).
- `lifeExpectancy.byStratum` keys must match `strata.shares`.
- `causes[].id` / `infantMortality.causes[].id` must exist in `vocab.causes`.
- Optional `injuryDetail` expands the `injury` cause using vocab IDs.
- `atlasId` on world countries links to world-atlas numeric ids for map highlight/zoom.
- Slot values may themselves contain `{poolName}` tokens.
- Keep statistics (LE, rates, shares) out of story text — those belong in `lifeExpectancy` / About panel.

## How the app uses packs

1. **World mode** picks a country by population from `world.json`.
2. If that ISO3 is in `catalog.countries`, the **country pack** roller runs.
3. Otherwise the **fallback** illustrative model runs (`fallback.json` + income band).

One-country mode is the same roller, just with a locked country.

## Adding a country

1. Copy `countries/EST.json` → `countries/XYZ.json`.
2. Replace stats; keep cause/stratum **IDs** from `vocab.json`.
3. Register the file in `catalog.json` → `countries`.
4. Ensure `world.json` includes the country (or add it).
5. Open a PR with sources cited in the pack’s `sources` array.

If you need a new cause or stratum label, update `vocab.json` in the same PR.
