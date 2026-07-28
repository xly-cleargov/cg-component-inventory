#!/usr/bin/env node
/**
 * Builds data/foundations.json from crosswalk + token sources (CG SCSS, DS flat tokens, ES curated).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');

const DS_TOKENS_PATH = join(root, '..', 'DesignSystem-POC', 'packages', 'tokens', 'dist', 'tokens.flat.json');
const CG_SCSS_PATH = join(root, '..', 'cleargov-shared', 'libs', 'shared-ui', 'styles', 'src', 'variables-tokens-generated.scss');
const CATALOG_PATH = join(dataDir, 'catalog.json');

const RAMP_HUES = ['blue', 'green', 'red', 'yellow', 'teal', 'orange', 'pink', 'purple', 'neutral'];
const RAMP_STEPS = ['0', '50', '100', '200', '300', '400', '500', '600', '700', '800', '900'];

const CG_PALETTE_SECTIONS = {
  blues: 'blue',
  reds: 'red',
  greens: 'green',
  yellows: 'yellow',
  oranges: 'orange',
  purples: 'purple',
  teals: 'teal',
  pinks: 'pink',
  grays: 'neutral',
};

/** Map DS ramp step (50–900) to CG native step suffix (05–90). */
const DS_STEP_TO_CG_SUFFIX = {
  50: '05',
  100: '10',
  200: '20',
  300: '30',
  400: '40',
  500: '50',
  600: '60',
  700: '70',
  800: '80',
  900: '90',
};

const CG_HUE_PREFIX = {
  blue: 'blue',
  red: 'red',
  green: 'green',
  yellow: 'yellow',
  orange: 'orange',
  purple: 'purple',
  teal: 'teal',
  pink: 'pink',
  neutral: 'gray',
};

const GROUP_LABELS = {
  brand: 'Brand',
  semantic: 'Semantic',
  text: 'Text',
  surface: 'Surface',
  blue: 'Blue palette',
  green: 'Green palette',
  red: 'Red palette',
  yellow: 'Yellow palette',
  teal: 'Teal palette',
  orange: 'Orange palette',
  pink: 'Pink palette',
  purple: 'Purple palette',
  neutral: 'Neutral palette',
  'cg-only': 'CG-only steps (no DS/ES equivalent)',
  Headers: 'Headers',
  Subheaders: 'Subheaders',
  Body: 'Body',
  Captions: 'Captions',
};

const CG_TYPOGRAPHY_SECTION_ORDER = ['headers', 'subheaders', 'body', 'captions'];

const CG_TYPOGRAPHY_GROUP = {
  headers: 'Headers',
  subheaders: 'Subheaders',
  body: 'Body',
  captions: 'Captions',
};

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeHex(value) {
  if (!value || typeof value !== 'string') return value;
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toUpperCase();
  return v;
}

const CG_PALETTE_SECTION_ORDER = ['reds', 'oranges', 'yellows', 'greens', 'blues', 'purples', 'teals', 'pinks', 'grays'];

function extractCgPaletteBlock(scss, section) {
  const idx = CG_PALETTE_SECTION_ORDER.indexOf(section);
  const nextSection =
    idx >= 0 && idx < CG_PALETTE_SECTION_ORDER.length - 1
      ? CG_PALETTE_SECTION_ORDER[idx + 1]
      : 'primary';
  const re = new RegExp(`${section}:\\s*\\(([\\s\\S]*?)\\n\\s*\\),\\s*\\n\\s*${nextSection}:`);
  const match = scss.match(re);
  return match?.[1] ?? '';
}

function parseCgPalettes(scss) {
  const palettes = {};
  for (const [section, hue] of Object.entries(CG_PALETTE_SECTIONS)) {
    const block = extractCgPaletteBlock(scss, section);
    if (!block) continue;
    const entryRe = /([\w]+-\d+):\s*\(\s*name:\s*([\w-]+),\s*hex:\s*(#[0-9A-Fa-f]{3,8})/g;
    let m;
    while ((m = entryRe.exec(block)) !== null) {
      const nativeName = m[2];
      if (!palettes[hue]) palettes[hue] = {};
      palettes[hue][nativeName] = {
        value: normalizeHex(m[3]),
        tokenRef: `colors.${section}.${m[1]}`,
        nativeName,
      };
    }
  }
  return palettes;
}

function resolveCgAtDsStep(cgPalettes, hue, dsStep) {
  const suffix = DS_STEP_TO_CG_SUFFIX[dsStep];
  if (!suffix) return null;
  const prefix = CG_HUE_PREFIX[hue];
  if (!prefix) return null;
  const nativeName = `${prefix}-${suffix}`;
  return cgPalettes[hue]?.[nativeName] ?? null;
}

function extractCgTypographyBlock(scss, section) {
  const typographyMatch = scss.match(/typography:\s*\(\s*([\s\S]*)\n\s*\)\s*\n\s*\)\s*;/);
  if (!typographyMatch) return '';
  const typographyBlock = typographyMatch[1];
  const idx = CG_TYPOGRAPHY_SECTION_ORDER.indexOf(section);
  const nextSection =
    idx >= 0 && idx < CG_TYPOGRAPHY_SECTION_ORDER.length - 1
      ? CG_TYPOGRAPHY_SECTION_ORDER[idx + 1]
      : null;
  if (nextSection) {
    const re = new RegExp(`${section}:\\s*\\(([\\s\\S]*?)\\n\\s*\\),\\s*\\n\\s*${nextSection}:`);
    return typographyBlock.match(re)?.[1] ?? '';
  }
  const re = new RegExp(`${section}:\\s*\\(([\\s\\S]*?)\\n\\s*\\)\\s*$`);
  return typographyBlock.match(re)?.[1]?.trim() ?? '';
}

function parseCgTypographyStyles(scss) {
  const styles = [];
  const entryRe =
    /([\w-]+):\s*\(\s*name:\s*([^,]+),\s*class:\s*([\w-]+),\s*px:\s*(\d+px),[\s\S]*?lineHeightPx:\s*(\d+px),[\s\S]*?fontWeight:\s*(\d+),[\s\S]*?letterSpacing:\s*(\d+px)/g;
  for (const section of CG_TYPOGRAPHY_SECTION_ORDER) {
    const block = extractCgTypographyBlock(scss, section);
    if (!block) continue;
    let m;
    while ((m = entryRe.exec(block)) !== null) {
      styles.push({
        section,
        group: CG_TYPOGRAPHY_GROUP[section],
        id: m[1],
        displayName: m[2].trim(),
        className: m[3],
        px: m[4],
        lineHeightPx: m[5],
        fontWeight: m[6],
        letterSpacing: m[7],
        tokenRef: `typography.${section}.${m[1]}`,
      });
    }
  }
  return styles;
}

function formatTypographyComposite({ px, lineHeightPx, fontWeight, letterSpacing }) {
  return `${px} · ${lineHeightPx} lh · w${fontWeight} · ls ${letterSpacing}`;
}

function parsePxNumber(value) {
  const m = String(value).match(/(\d+(?:\.\d+)?)px/);
  return m ? parseFloat(m[1]) : null;
}

function formatDsTypographyObject(val) {
  if (!val || typeof val !== 'object' || !val.fontSize) return null;
  return `${val.fontSize} · ${val.lineHeight} lh · w${val.fontWeight}`;
}

function dsTypographyDetailFromObject(val) {
  if (!val || typeof val !== 'object' || !val.fontSize) return null;
  return {
    size: val.fontSize,
    lineHeight: val.lineHeight,
    weight: String(val.fontWeight),
    letterSpacing: val.letterSpacing ?? null,
  };
}

function readDsToken(tokenRef, ds) {
  if (!tokenRef) return null;
  if (ds[tokenRef] != null) return ds[tokenRef];
  const dotted = tokenRef.replace(/\//g, '.');
  if (ds[dotted] != null) return ds[dotted];
  return null;
}

function findDsTypographyMatch(style, dsFlat) {
  const target = parsePxNumber(style.px);
  if (target == null) return null;
  let best = null;
  let bestDelta = Infinity;
  for (const [key, val] of Object.entries(dsFlat)) {
    if (!key.startsWith('typography.edit.') || typeof val !== 'object' || !val.fontSize) continue;
    const size = parsePxNumber(val.fontSize);
    if (size == null) continue;
    const delta = Math.abs(size - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { key, val };
    }
  }
  if (!best) return null;
  const { key, val } = best;
  return {
    tokenRef: key,
    value: `${val.fontSize} · ${val.lineHeight} lh · w${val.fontWeight}`,
    typographyDetail: {
      size: val.fontSize,
      lineHeight: val.lineHeight,
      weight: String(val.fontWeight),
      letterSpacing: val.letterSpacing ?? null,
    },
  };
}

function findEsTypographyMatch(style, esTokens) {
  const target = parsePxNumber(style.px);
  if (target == null) return null;
  const sizes = Object.entries(esTokens).filter(([k]) => k.startsWith('fontSize.'));
  let best = null;
  let bestDelta = Infinity;
  for (const [key, val] of sizes) {
    const size = parsePxNumber(val);
    if (size == null) continue;
    const delta = Math.abs(size - target);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = { key, val };
    }
  }
  if (!best || bestDelta > 2) return null;
  return {
    tokenRef: best.key,
    value: best.val,
    typographyDetail: { size: best.val },
  };
}

function buildCgTypographyStyleRows(cgStyles, dsFlat, esTokens) {
  return cgStyles.map((style) => {
    const apps = {
      cg: {
        tokenRef: style.tokenRef,
        fallback: formatTypographyComposite(style),
        nativeName: style.className,
        typographyDetail: {
          displayName: style.displayName,
          size: style.px,
          lineHeight: style.lineHeightPx,
          weight: style.fontWeight,
          letterSpacing: style.letterSpacing,
        },
      },
    };
    const dsMatch = findDsTypographyMatch(style, dsFlat);
    if (dsMatch) apps.ds = { tokenRef: dsMatch.tokenRef, fallback: dsMatch.value, typographyDetail: dsMatch.typographyDetail };
    const esMatch = findEsTypographyMatch(style, esTokens);
    if (esMatch) apps.es = { tokenRef: esMatch.tokenRef, fallback: esMatch.value, typographyDetail: esMatch.typographyDetail };
    return {
      group: style.group,
      id: `cg-typo-${style.id}`,
      label: style.displayName,
      cgOnly: true,
      apps,
    };
  });
}

function cgNativeNameFromTokenRef(tokenRef) {
  if (!tokenRef?.startsWith('colors.')) return null;
  const parts = tokenRef.split('.');
  return parts.length >= 3 ? parts[parts.length - 1] : null;
}

function parseCgScss(scss) {
  const colors = {};
  const colorBlockRe = /(\w[\w-]*):\s*\(\s*name:\s*([\w-]+),\s*hex:\s*(#[0-9A-Fa-f]{3,8})/g;
  let m;
  while ((m = colorBlockRe.exec(scss)) !== null) {
    colors[`colors.${m[1]}.${m[2]}`] = normalizeHex(m[3]);
  }
  const bodyBg = scss.match(/body:\s*\(\s*background:\s*\(\s*hex:\s*(#[0-9A-Fa-f]{3,8})/);
  const bodyColor = scss.match(/color:\s*\(\s*hex:\s*(#[0-9A-Fa-f]{3,8})/);
  if (bodyBg) colors['colors.body.background'] = normalizeHex(bodyBg[1]);
  if (bodyColor) colors['colors.body.color'] = normalizeHex(bodyColor[1]);

  const spacing = {};
  const spacingRe = /m-(\d+):\s*\(\s*name:[^,]+,\s*remMultiplier:\s*([\d.]+)/g;
  while ((m = spacingRe.exec(scss)) !== null) {
    const px = Math.round(parseFloat(m[2]) * 16);
    spacing[`spacing.margin.m-${m[1].padStart(2, '0')}`] = `${px}px`;
  }

  const typography = {};
  typography['typography.font-family'] = 'Montserrat';
  const typoStyles = parseCgTypographyStyles(scss);
  for (const style of typoStyles) {
    typography[`${style.tokenRef}.px`] = style.px;
    typography[`${style.tokenRef}.lineHeightPx`] = style.lineHeightPx;
    typography[`${style.tokenRef}.fontWeight`] = style.fontWeight;
    typography[`${style.tokenRef}.letterSpacing`] = style.letterSpacing;
  }

  return { colors, spacing, typography, radius: {}, palettes: parseCgPalettes(scss), typoStyles };
}

function extractDsColorRamps(flat) {
  const ramps = {};
  for (const [key, value] of Object.entries(flat)) {
    if (typeof value !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(value)) continue;
    let match = key.match(/^color\.(\w+)\.primary\.(\d+)$/);
    if (match) {
      const [, hue, step] = match;
      if (!ramps[hue]) ramps[hue] = {};
      ramps[hue][step] = { value: normalizeHex(value), tokenRef: key };
      continue;
    }
    match = key.match(/^color\.(yellow|teal|orange|pink|purple)\.(\d+)$/);
    if (match) {
      const [, hue, step] = match;
      if (!ramps[hue]) ramps[hue] = {};
      ramps[hue][step] = { value: normalizeHex(value), tokenRef: key };
      continue;
    }
    match = key.match(/^color\.neutral\.primary\.(\d+)$/);
    if (match) {
      if (!ramps.neutral) ramps.neutral = {};
      ramps.neutral[match[1]] = { value: normalizeHex(value), tokenRef: key };
    }
  }
  return ramps;
}

function loadEsPalettes() {
  const path = join(dataDir, 'foundations', 'es-palettes.json');
  if (!existsSync(path)) return {};
  return loadJson(path).palettes ?? {};
}

function extractEsColorRamps(palettes) {
  const ramps = {};
  for (const [hue, steps] of Object.entries(palettes)) {
    for (const [step, hex] of Object.entries(steps)) {
      if (!ramps[hue]) ramps[hue] = {};
      ramps[hue][step] = {
        value: normalizeHex(hex),
        tokenRef: hue === 'blue' ? `color.sky.${step}` : `color.${hue === 'neutral' ? 'gray' : hue}.${step}`,
      };
    }
  }
  return ramps;
}

function buildColorRampRows(dsRamps, cgPalettes, esRamps) {
  const rows = [];
  for (const hue of RAMP_HUES) {
    const steps = new Set([
      ...Object.keys(dsRamps[hue] ?? {}),
      ...Object.keys(esRamps[hue] ?? {}),
      ...RAMP_STEPS.filter((s) => resolveCgAtDsStep(cgPalettes, hue, s)),
    ]);
    const ordered = RAMP_STEPS.filter((s) => steps.has(s));
    for (const step of ordered) {
      const apps = {};
      if (dsRamps[hue]?.[step]) {
        apps.ds = { tokenRef: dsRamps[hue][step].tokenRef, fallback: dsRamps[hue][step].value };
      }
      const cgEntry = resolveCgAtDsStep(cgPalettes, hue, step);
      if (cgEntry) {
        apps.cg = {
          tokenRef: cgEntry.tokenRef,
          fallback: cgEntry.value,
          nativeName: cgEntry.nativeName,
        };
      }
      if (esRamps[hue]?.[step]) {
        apps.es = { tokenRef: esRamps[hue][step].tokenRef, fallback: esRamps[hue][step].value };
      }
      if (Object.keys(apps).length === 0) continue;
      rows.push({
        group: hue,
        id: `${hue}-${step}`,
        label: `${hue.charAt(0).toUpperCase() + hue.slice(1)} ${step}`,
        apps,
      });
    }
  }
  return rows;
}

function mappedCgNativeNames() {
  const names = new Set();
  for (const hue of RAMP_HUES) {
    const prefix = CG_HUE_PREFIX[hue];
    if (!prefix) continue;
    for (const suffix of Object.values(DS_STEP_TO_CG_SUFFIX)) {
      names.add(`${prefix}-${suffix}`);
    }
  }
  return names;
}

function cgNativeSortKey(nativeName) {
  const m = nativeName.match(/^(\w+)-(\d+)$/);
  if (!m) return [999, 0, nativeName];
  const hueKey = m[1] === 'gray' ? 'neutral' : m[1];
  const hueIdx = RAMP_HUES.indexOf(hueKey);
  return [hueIdx >= 0 ? hueIdx : 999, parseInt(m[2], 10), nativeName];
}

function buildCgOnlyColorRows(cgPalettes) {
  const mapped = mappedCgNativeNames();
  const extras = [];
  for (const hue of RAMP_HUES) {
    for (const entry of Object.values(cgPalettes[hue] ?? {})) {
      if (mapped.has(entry.nativeName)) continue;
      extras.push({
        hue,
        nativeName: entry.nativeName,
        entry,
      });
    }
  }
  extras.sort((a, b) => {
    const ka = cgNativeSortKey(a.nativeName);
    const kb = cgNativeSortKey(b.nativeName);
    return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
  });
  return extras.map(({ nativeName, entry }) => ({
    group: 'cg-only',
    id: `cg-only-${nativeName}`,
    label: nativeName,
    cgOnly: true,
    apps: {
      cg: {
        tokenRef: entry.tokenRef,
        fallback: entry.value,
        nativeName: entry.nativeName,
      },
    },
  }));
}

function loadDsTokens() {
  if (!existsSync(DS_TOKENS_PATH)) return {};
  return loadJson(DS_TOKENS_PATH);
}

function loadCgTokens() {
  if (!existsSync(CG_SCSS_PATH)) {
    return { colors: {}, spacing: {}, typography: {}, radius: {}, palettes: {}, typoStyles: [] };
  }
  return parseCgScss(readFileSync(CG_SCSS_PATH, 'utf8'));
}

function loadEsTokens() {
  const path = join(dataDir, 'foundations', 'es.tokens.json');
  if (!existsSync(path)) return {};
  const data = loadJson(path);
  return data.tokens ?? {};
}

function lookup(app, tokenRef, sources) {
  if (!tokenRef) return null;
  const { ds, cg, es } = sources;
  if (app === 'ds') {
    const raw = readDsToken(tokenRef, ds);
    if (raw == null) return null;
    if (typeof raw === 'object') return formatDsTypographyObject(raw);
    return String(raw);
  }
  if (app === 'cg') {
    if (cg.colors[tokenRef]) return cg.colors[tokenRef];
    if (cg.spacing[tokenRef]) return cg.spacing[tokenRef];
    if (cg.typography[tokenRef]) return cg.typography[tokenRef];
    if (cg.radius[tokenRef]) return cg.radius[tokenRef];
  }
  if (app === 'es' && es[tokenRef] != null) return String(es[tokenRef]);
  return null;
}

function resolveEntry(entry, sources) {
  const apps = {};
  for (const app of ['cg', 'ds', 'es']) {
    const spec = entry.apps?.[app];
    if (!spec) continue;
    const resolved = lookup(app, spec.tokenRef, sources);
    const value = {
      value: resolved ?? spec.fallback ?? null,
      tokenRef: spec.tokenRef ?? null,
    };
    if (app === 'cg') {
      const nativeName = spec.nativeName ?? cgNativeNameFromTokenRef(spec.tokenRef);
      if (nativeName) value.nativeName = nativeName;
    }
    if (spec.typographyDetail) {
      value.typographyDetail = spec.typographyDetail;
    } else if (app === 'ds') {
      const raw = readDsToken(spec.tokenRef, sources.ds);
      const detail = dsTypographyDetailFromObject(raw);
      if (detail) value.typographyDetail = detail;
    }
    apps[app] = value;
  }
  return apps;
}

function groupRows(rows) {
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) {
      const label = GROUP_LABELS[row.group] ?? row.group.charAt(0).toUpperCase() + row.group.slice(1);
      groups.set(row.group, { id: row.group, label, tokens: [] });
    }
    groups.get(row.group).tokens.push({
      id: row.id,
      label: row.label,
      apps: row.apps,
      ...(row.cgOnly ? { cgOnly: true } : {}),
    });
  }
  const order = ['brand', 'semantic', 'text', 'surface', 'family', 'scale', 'weight', 'line-height', ...RAMP_HUES, 'cg-only', 'Headers', 'Subheaders', 'Body', 'Captions'];
  return [...groups.values()].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    if (ai === -1 && bi === -1) return a.label.localeCompare(b.label);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function buildSection(kind, items, sources) {
  const rows = items.map((item) => ({
    group: item.group,
    id: item.id,
    label: item.label,
    apps: resolveEntry(item, sources),
    cgOnly: item.cgOnly ?? false,
  }));
  return { groups: groupRows(rows) };
}

function buildColorSection(crosswalkColors, sources) {
  const dsRamps = extractDsColorRamps(sources.ds);
  const cgPalettes = sources.cg.palettes ?? {};
  const esRamps = extractEsColorRamps(loadEsPalettes());
  const rampRows = buildColorRampRows(dsRamps, cgPalettes, esRamps);
  const cgOnlyRows = buildCgOnlyColorRows(cgPalettes);
  const crosswalkIds = new Set(crosswalkColors.map((c) => c.id));
  const rampIds = new Set(rampRows.map((r) => r.id));
  const merged = [
    ...crosswalkColors,
    ...rampRows.filter((r) => !crosswalkIds.has(r.id)),
    ...cgOnlyRows.filter((r) => !crosswalkIds.has(r.id) && !rampIds.has(r.id)),
  ];
  return buildSection('colors', merged, sources);
}

function buildTypographySection(crosswalkTypography, sources) {
  const cgTypoRows = buildCgTypographyStyleRows(
    sources.cg.typoStyles ?? [],
    sources.ds,
    sources.es
  );
  const merged = [...crosswalkTypography, ...cgTypoRows];
  return buildSection('typography', merged, sources);
}

export function buildFoundations() {
  const crosswalk = loadJson(join(dataDir, 'foundations-crosswalk.json'));
  const catalog = existsSync(CATALOG_PATH) ? loadJson(CATALOG_PATH) : { meta: { sources: {} } };

  const sources = {
    ds: loadDsTokens(),
    cg: loadCgTokens(),
    es: loadEsTokens(),
  };

  const colorSection = buildColorSection(crosswalk.colors ?? [], sources);
  const typographySection = buildTypographySection(crosswalk.typography ?? [], sources);
  const colorCount = colorSection.groups.reduce((n, g) => n + g.tokens.length, 0);
  const typographyCount = typographySection.groups.reduce((n, g) => n + g.tokens.length, 0);

  const output = {
    meta: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      sources: {
        cg: {
          label: 'ClearGov 1.0',
          figmaUrl: catalog.meta?.sources?.cg?.figmaUrl ?? null,
          tokenSource: existsSync(CG_SCSS_PATH)
            ? 'cleargov-shared/variables-tokens-generated.scss'
            : 'foundations-crosswalk fallbacks',
        },
        ds: {
          label: 'Disclosure Studio (Gravity)',
          figmaUrl: catalog.meta?.sources?.ds?.figmaUrl ?? null,
          tokenSource: existsSync(DS_TOKENS_PATH)
            ? 'DesignSystem-POC/packages/tokens/dist/tokens.flat.json'
            : 'foundations-crosswalk fallbacks',
        },
        es: {
          label: 'Engagement Studio (Community DS)',
          figmaUrl: catalog.meta?.sources?.es?.figmaUrl ?? null,
          tokenSource: 'data/foundations/es-palettes.json',
        },
      },
      notes:
        'Semantic crosswalk plus auto-generated color ramps (blue, green, red, yellow, teal, orange, pink, purple, neutral) from live token files when sibling repos are present.',
    },
    sections: {
      colors: colorSection,
      typography: typographySection,
      spacing: buildSection('spacing', crosswalk.spacing ?? [], sources),
    },
  };

  const outPath = join(dataDir, 'foundations.json');
  writeFileSync(outPath, `${JSON.stringify(output, null, 2)}\n`);
  console.log(
    `Wrote foundations.json (${colorCount} colors, ${typographyCount} typography, ${crosswalk.spacing?.length ?? 0} spacing)`
  );
  return output;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}` || process.argv[1]?.endsWith('build-foundations.mjs')) {
  buildFoundations();
}
