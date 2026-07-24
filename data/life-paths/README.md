# Life-path specs (contributor → LLM → code)

Use these YAML specs to design **stats-grounded, highly random** life stories per country.

## Workflow

1. Copy [`TEMPLATE.life-path.yaml`](TEMPLATE.life-path.yaml) → `{ISO3}.life-path.yaml` (e.g. `EST.life-path.yaml`).
2. Fill variables (with weights + sources), beats, and event pools.
3. Write 3–5 `example_rolls` you like — those are the acceptance tests.
4. Give the filled file to an LLM (keep the `llm_brief` section) or open a PR.

## What belongs here vs the country pack

| In the life-path YAML | In `countries/XXX.json` |
|---|---|
| Story beats, templates, event pools | Mortality, LE, cause weights |
| Player-facing variable labels | Machine stratum ids / rates |
| `fact` vs `color` tags | Published tables & years |
| Example narrative outputs | Sources list |

## Tip

Ship a thin vertical slice first: **birth → ~age 15**. Expand pools once that feels right.
