# Component Inventory Data

This folder holds the cross-app component catalog for ClearGov (ES, DS, CG).

## File layout

| File | Purpose |
| --- | --- |
| `schema/component-catalog.schema.json` | JSON Schema for validation |
| `sources/cg.raw.json` | ClearGov 1.0 design-system extraction |
| `sources/ds.raw.json` | Disclosure Studio (DevExtreme) extraction |
| `sources/es.raw.json` | Engagement Studio in-app components extraction |
| `crosswalk.json` | Maps source component ids → canonical family ids (aliases merged via `scripts/family-aliases.mjs`) |
| `catalog.json` | Normalized catalog with gaps — **loaded by the Angular app** |
| `design-enrichment/enrichment.json` | Curated Figma/code design specs merged into raw sources at build time |
| `cg-figma-components.json` | CG `cg-*` → Figma COMPONENTS page node ids (design links in UI) |
| `ds-figma-components.json` | DS `dx-*` / Gravity → Figma component page node ids |
| `es-figma-components.json` | ES `es-*` → Community Design System frame/page node ids |
| `ds-gravity-components.json` | Gravity Figma components for DS that are not DevExtreme widgets (e.g. Avatar) |

**Family aliases:** Some apps name the same UI pattern differently (e.g. CG `cg-tab` → `tabs`, DS `dx-switch` → `switch`). `scripts/family-aliases.mjs` merges these into one family; category differences surface as `taxonomy` gaps on the detail page.

DS extraction scans three layers: **DevExtreme** (only `dx-*` widgets with verified usage — template tags in `.html`, plus `dx-notify` via `devextreme/ui/notify` imports; full option lists parsed from `devextreme-angular` types when `repos/gravity-reporting-next-ui/node_modules` is present), **custom Angular** (mapped reusable primitives from `DS_CUSTOM_TO_FAMILY` plus components with tangible extracted design — colors/typography/radius/elevation or token-backed spacing; domain workflow/page shells with only layout margins are excluded), and **Gravity design-system** manifest entries.

## Figma (read-only)

Design specs are referenced from Figma but **never modified**. Each raw file's `origin.figmaUrl` points to:

| App | Figma |
| --- | --- |
| CG | [ClearGov Design System](https://www.figma.com/design/JdGC6oj27gAt2VGDauVH2G/ClearGov-Design-System?node-id=5344-1363&p=f&t=kdMedCVWjFszF8po-0) |
| DS | [Gravity design foundations](https://www.figma.com/design/cErW0lkFuaZarQkuRr6bS8/Gravity-design-foundations?node-id=4653-10511) |
| ES | [Community Design System](https://www.figma.com/design/lyDU3cSfPqsdONVBLi6f1T/Community-Design-System?node-id=1-2) |

Use Figma Dev Mode MCP read tools (`get_metadata`, `get_design_context`, `get_variable_defs`) to enrich design sections — do not use write tools.

## Refresh workflow

1. Run extraction against local repo clones: `npm run extract:repos`
2. Regenerate catalog + crosswalk: `npm run build:catalog` (also applies `design-enrichment/`)
3. Copy to app assets: `npm run sync:data`
4. Validate: `npm run validate:data`

To refresh design enrichment only (without re-extracting repos): `npm run enrich:design`

## Master extraction prompt

Use the same prompt skeleton; only the **SOURCE CONTEXT** block changes.

```text
You are extracting a component inventory for ClearGov's cross-app catalog.

SOURCE CONTEXT
- App code: <ES | DS | CG>
- Repo / package path: <PATH OR PACKAGE@VERSION>
- Framework hint: <Angular | React | mixed>
- Component origin: <npm design system | DevExtreme | in-app components>
- Include ALL UI components and related UI services (modals, toasts, drawers, etc.).
- Exclude pure business/feature pages that are not reusable UI primitives or shared composites.
- If uncertain whether something is a shared component, INCLUDE it and set "confidence": "low".

OUTPUT
- Emit ONLY valid JSON matching this shape (no markdown fences):
{
  "source": "cg|ds|es",
  "extractedAt": "<ISO-8601>",
  "origin": { "repoOrPackage": "...", "ref": "...", "notes": "..." },
  "components": [ /* ComponentRecord[] */ ]
}

ComponentRecord:
{
  "id": "stable-kebab-or-selector",
  "displayName": "Human name",
  "category": "action|form|feedback|navigation|layout|data|overlay|media|typography|other",
  "framework": "angular|react|web-component|devextreme|other",
  "packageOrPath": "import path or folder",
  "selectorOrExport": "cg-button | dx-button | app-button | Button",
  "usage": { "instanceCount": null, "fileCount": null, "samplePaths": [] },
  "api": {
    "props": [{ "name": "", "type": "", "default": null, "required": false, "values": [], "description": "" }],
    "events": [{ "name": "", "payloadType": "", "description": "" }],
    "slots": [{ "name": "default|start|...", "description": "" }],
    "methods": [{ "name": "", "signature": "", "description": "" }],
    "services": [{ "name": "", "methods": [], "description": "" }]
  },
  "design": {
    "colors": [{ "name": "bg|fg|border|...", "value": "#hex|token", "tokenRef": null }],
    "spacing": [{ "name": "padding|gap|...", "value": "8px|token", "tokenRef": null }],
    "radius": [],
    "typography": [],
    "elevation": [],
    "states": [{ "name": "hover|focus|disabled|error|loading", "notes": "" }]
  },
  "a11y": { "role": null, "labelProps": [], "notes": "" },
  "migrateHint": "swap|adapt|rewrite|keep|unknown",
  "confidence": "high|medium|low",
  "notes": ""
}

RULES
1. Prefer public API from TypeScript types / @Input/@Output / PropTypes / documented DevExtreme options.
2. For design values: prefer design tokens or CSS variables; if hardcoded, record the literal and set tokenRef null.
3. Do not invent values. If unknown, use null / [] and confidence "low".
4. For DevExtreme: record the widget name (dx-button) AND any local wrapper that narrows options.
5. For CG npm DS: record published public API only (not private internals).
6. Count usage with ripgrep-style search when possible; otherwise leave counts null.
7. After listing components, also emit a short "familiesGuess" map: { "sourceId": "suggested-family-id" }.
```

### CG addendum

```text
CG ADDENDUM
- Inventory every public component export from the design-system package.
- Capture token files / CSS custom properties used by each component when available.
- Include Angular/React wrappers only as consumption notes; primary record is the core component API.
- Include shared UI services if the package ships them (toast/modal/drawer).
```

### DS addendum

```text
DS ADDENDUM
- Inventory every DevExtreme widget used (dx-*) and every local wrapper around DevExtreme.
- Separate "engine keep" candidates (data grid, pivot, tree, spreadsheet editors) via migrateHint=keep.
- Record theme/customization approach (DevExtreme theme vars vs app LESS/SCSS hex).
- Include dialog/notify/toast helpers from DevExtreme if used.
```

### ES addendum

```text
ES ADDENDUM
- Inventory shared/reusable components under the project's shared UI directories.
- Prefer components with multiple consumers; still include single-use if they look like design-system candidates.
- Capture Angular inputs/outputs or React props fully.
- Note any third-party primitives wrapped by ES components.
```

### Crosswalk / gap prompt

```text
Given es.raw.json, ds.raw.json, cg.raw.json, produce:
1) crosswalk.json mapping each source component id → family id (create new family ids when no peer exists)
2) catalog.json merging implementations under families
3) gaps[] per family comparing api.props names/values, design tokens/literals, and presence
Gap kinds: presence | api | design | a11y | service
Severity: low | medium | high | blocker
Do not invent APIs; only compare what is in the raw files. Flag unresolved mappings.
```
