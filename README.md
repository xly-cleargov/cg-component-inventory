# CG Component Inventory

Standalone Angular app for comparing UI components across ClearGov applications:

- **CG** — ClearGov 1.0 (npm design system)
- **DS** — Disclosure Studio (DevExtreme)
- **ES** — Engagement Studio (in-app components)

## Quick start

```bash
npm install
npm start
```

Open [http://localhost:4400](http://localhost:4400)

## Data workflow

Catalog data lives in `data/`:

| File | Purpose |
| --- | --- |
| `data/sources/*.raw.json` | Per-app extraction output |
| `data/crosswalk.json` | Maps source ids → family ids |
| `data/catalog.json` | Normalized catalog loaded by the app |

After updating raw inventories:

```bash
npm run build:catalog   # regenerate catalog from raw + crosswalk
npm run sync:data       # copy data/ → public/data/ (no regen)
npm run validate:data   # JSON schema check
```

Extraction prompts are documented in [`data/README.md`](data/README.md).

## Routes

| Path | View |
| --- | --- |
| `/` | Searchable family list with presence matrix |
| `/family/:id` | Side-by-side API, design, and gaps |
| `/gaps` | Flat gap registry with filters |
| `/sources/:app` | Raw per-app component list (`cg`, `ds`, `es`) |

## Replacing placeholder data

Current raw JSON files contain **placeholder fixture data**. To load real inventories:

1. Run the extraction prompts in `data/README.md` against each source repo
2. Save outputs to `data/sources/cg.raw.json`, `ds.raw.json`, `es.raw.json`
3. Update `data/crosswalk.json` with family mappings
4. Run `npm run build:catalog && npm run validate:data`
