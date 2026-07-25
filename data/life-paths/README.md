# Life-path specs (contributor → LLM → code)

Use these YAML specs to design **stats-grounded, highly random** life stories per country.

## Workflow

1. Copy [`TEMPLATE.life-path.yaml`](TEMPLATE.life-path.yaml) → `{ISO3}.life-path.yaml` (e.g. `EST.life-path.yaml`).
2. Fill variables (with weights + sources), beats, and event pools.
3. Write 3–5 `example_rolls` you like — those are the acceptance tests.
4. Compile to JSON for the web app:

```bash
python3 scripts/compile-life-path.py EST
```

5. Point the country pack at the JSON (`"lifePathSpec": "life-paths/EST.life-path.json"`) and open a PR.

## Runtime

The browser loads the **JSON** compile (`*.life-path.json`), not the YAML.
YAML stays the human-editable source; recompile after edits.

## Examples

- [`EST.life-path.yaml`](EST.life-path.yaml) — Estonia stats-first draft (2024 births / mothers). Flair welcome.
- [`EST.life-path.json`](EST.life-path.json) — compiled runtime for `js/rebirth.js`.

## What belongs here vs the country pack

| In the life-path YAML | In `countries/XXX.json` |
|---|---|
| Story beats, templates, event pools | Mortality, LE, cause weights |
| Player-facing variable labels | Machine stratum ids / rates |
| `fact` vs `color` tags | Published tables & years |
| Example narrative outputs | Sources list |

## Tip

Ship a thin vertical slice first: **birth → ~age 15**. Expand pools once that feels right.
