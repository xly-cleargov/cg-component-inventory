/**
 * Extract CG component design values from cleargov-shared:
 * - component SCSS (when present)
 * - global style partials (_badge.scss, _tag.scss, …)
 * - SCSS variables ($badge-*, $theme-tag-colors, …)
 * - utility classes referenced in TS/HTML (bg-info-light, alert-success, …)
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { extractDesignFromStyles, mergeDesign } from './design-extract.mjs';

const SKIP_VALUES = new Set(['inherit', 'transparent', 'none', 'auto', 'unset', 'initial', 'null']);
const REM_BASE = 16;

/** folder → global partial name(s) under styles/src */
const FOLDER_STYLE_PARTIALS = {
  drawer: ['offcanvas'],
  breadcrumbs: ['breadcrumb'],
  'slide-up': ['offcanvas'],
  tab: ['nav'],
  step: ['stepper'],
  'navbar-item': ['navbar'],
  notification: ['alert'],
  'tooltip-help': ['tooltip'],
  'toast-content': ['toast'],
  header: ['appbar'],
  'button-dropdown': ['dropdown'],
  'button-group': ['button-group'],
  'actions-button-group': ['buttons'],
  'page-layout': ['layout'],
  table: ['tables'],
  'table-header-toolbar': ['table-header-toolbar'],
  'banner-slider': ['banner'],
  'carousel-image': ['carousel'],
  grid: ['grid'],
  'checkbox-group': ['forms/form-control'],
  'radio-group': ['forms/form-control'],
  'grouped-bar': ['progress'],
  link: ['link'],
  pagination: ['pagination'],
  panel: ['panel'],
  timeline: ['timeline'],
  'timeline-chart': ['timeline-chart'],
  'type-ahead': ['type-ahead'],
  'search-select': ['search-select'],
  'combo-box': ['combo-box'],
  'color-picker': ['color-picker'],
  'tree-settings': ['tree-settings'],
  'map-box': ['mapbox'],
  tabs: ['nav'],
  layout: ['page-layout'],
  loader: ['loader'],
};

/** folder → SCSS variable prefix(es) in _variables.scss */
const FOLDER_VAR_PREFIXES = {
  drawer: ['offcanvas'],
  breadcrumbs: ['breadcrumb'],
  notification: ['alert'],
  'slide-up': ['offcanvas'],
  header: ['appbar'],
  tab: ['nav-link', 'nav-tabs', 'nav'],
  'navbar-item': ['navbar'],
  'grouped-bar': ['progress', 'progress-bar'],
  grid: ['grid'],
  'timeline-chart': ['timeline-chart'],
  timeline: ['timeline'],
  pagination: ['pagination'],
  tooltip: ['tooltip'],
  'tooltip-help': ['tooltip'],
  modal: ['modal'],
  toast: ['toast'],
  card: ['card'],
  accordion: ['accordion'],
  switch: ['form-switch'],
  checkbox: ['form-check'],
  radio: ['form-check'],
  'checkbox-group': ['form-check'],
  'radio-group': ['form-check'],
  tabs: ['nav-tabs', 'nav-link', 'nav'],
  layout: ['page-layout'],
  loader: ['loader'],
};

/** folder → $theme-*-colors map variable name */
const FOLDER_THEME_MAPS = {
  tag: '$theme-tag-colors',
  notification: '$theme-alert-colors',
  banner: '$theme-banner-colors',
};

let cachedContext = null;

function emptyDesign() {
  return { colors: [], spacing: [], radius: [], typography: [], elevation: [], states: [] };
}

function pushUnique(arr, item, limit = 40) {
  if (arr.length >= limit) return;
  if (arr.some((x) => x.name === item.name && x.value === item.value)) return;
  arr.push(item);
}

function mergeDesignAccumulate(base, extra) {
  const out = { ...base };
  for (const key of ['colors', 'spacing', 'radius', 'typography', 'elevation', 'states']) {
    out[key] = [...(base[key] ?? [])];
    for (const item of extra[key] ?? []) {
      pushUnique(out[key], item, 40);
    }
  }
  return out;
}

function parseTokenHexMap(scss) {
  const map = new Map();
  const re = /([\w][\w-]*):\s*\(\s*name:\s*[\w-]+,\s*hex:\s*(#[0-9A-Fa-f]{3,8})/g;
  let m;
  while ((m = re.exec(scss)) !== null) {
    map.set(m[1], m[2].toUpperCase());
  }
  return map;
}

function parseScssVars(scss) {
  const vars = new Map();
  for (const line of scss.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('$')) continue;
    const m = trimmed.match(/^\$([a-zA-Z0-9_-]+):\s*(.+?)(?:\s*!default)?;?\s*$/);
    if (m) vars.set(m[1], m[2].trim());
  }
  return vars;
}

function remToPx(value) {
  const m = value.match(/^(-?[\d.]+)rem$/);
  if (!m) return value;
  const px = parseFloat(m[1]) * REM_BASE;
  return `${Number.isInteger(px) ? px : px.toFixed(2).replace(/\.?0+$/, '')}px`;
}

function normalizeHex(value) {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toUpperCase();
  if (v === '#fff') return '#FFFFFF';
  return v;
}

function createResolver(scssVars, tokenHex) {
  const memo = new Map();

  function resolve(raw, depth = 0) {
    const key = raw.trim();
    if (memo.has(key)) return memo.get(key);
    if (depth > 24) {
      const fallback = { value: key, tokenRef: null };
      memo.set(key, fallback);
      return fallback;
    }

    let result;
    if (SKIP_VALUES.has(key)) {
      result = { value: key, tokenRef: null };
    } else if (/^#[0-9a-f]{3,8}$/i.test(key)) {
      result = { value: normalizeHex(key), tokenRef: null };
    } else if (/^(-?[\d.]+)(px|rem|em|%|vh|vw)$/.test(key)) {
      result = { value: remToPx(key), tokenRef: null };
    } else if (/^\d+$/.test(key)) {
      result = { value: key, tokenRef: null };
    } else if (key.startsWith('map-deep-get(')) {
      const parts = [...key.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
      const tokenName = parts[parts.length - 1];
      const tokenPath = parts.join('.');
      const hex = tokenHex.get(tokenName);
      result = hex
        ? { value: hex, tokenRef: tokenPath }
        : { value: tokenPath, tokenRef: tokenPath };
    } else if (key.startsWith('$')) {
      const varName = key.slice(1);
      if (scssVars.has(varName)) {
        const inner = resolve(scssVars.get(varName), depth + 1);
        result = { ...inner, tokenRef: inner.tokenRef ?? `$${varName}` };
      } else if (tokenHex.has(varName)) {
        result = { value: tokenHex.get(varName), tokenRef: varName };
      } else {
        result = { value: key, tokenRef: `$${varName}` };
      }
    } else {
      const mul = key.match(/^\$([a-zA-Z0-9_-]+)\s*\*\s*([\d.]+)$/);
      if (mul) {
        const base = resolve(`$${mul[1]}`, depth + 1);
        if (String(base.value).endsWith('rem')) {
          const px = parseFloat(base.value) * parseFloat(mul[2]) * REM_BASE;
          result = { value: `${px}px`, tokenRef: base.tokenRef };
        } else if (String(base.value).endsWith('px')) {
          const px = parseFloat(base.value) * parseFloat(mul[2]);
          result = { value: `${px}px`, tokenRef: base.tokenRef };
        } else {
          result = { value: key, tokenRef: base.tokenRef };
        }
      } else {
        const add = key.match(/^\$([a-zA-Z0-9_-]+)\s*\+\s*\$([a-zA-Z0-9_-]+)$/);
        if (add) {
          result = resolve(`$${add[1]}`, depth + 1);
        } else if (tokenHex.has(key)) {
          result = { value: tokenHex.get(key), tokenRef: key };
        } else {
          result = { value: key, tokenRef: null };
        }
      }
    }

    memo.set(key, result);
    return result;
  }

  return { resolve, scssVars, tokenHex };
}

function createCgDesignContext(cgRepoRoot) {
  if (cachedContext?.cgRepoRoot === cgRepoRoot) return cachedContext;

  const stylesRoot = join(cgRepoRoot, 'libs', 'shared-ui', 'styles', 'src');
  const tokensPath = join(stylesRoot, 'variables-tokens-generated.scss');
  const variablesPath = join(stylesRoot, '_variables.scss');

  const tokenHex = existsSync(tokensPath) ? parseTokenHexMap(readFileSync(tokensPath, 'utf8')) : new Map();
  const variablesScss = existsSync(variablesPath) ? readFileSync(variablesPath, 'utf8') : '';
  const scssVars = parseScssVars(variablesScss);
  const resolver = createResolver(scssVars, tokenHex);

  cachedContext = { cgRepoRoot, stylesRoot, variablesScss, resolver };
  return cachedContext;
}

function findStylePartials(folder, stylesRoot) {
  const names = new Set([folder]);
  for (const alias of FOLDER_STYLE_PARTIALS[folder] ?? []) names.add(alias);
  const first = folder.split('-')[0];
  if (first !== folder) names.add(first);

  const paths = [];
  for (const name of names) {
    const candidates = [
      join(stylesRoot, `_${name}.scss`),
      join(stylesRoot, `${name}.scss`),
      join(stylesRoot, 'forms', `_${name.split('/').pop()}.scss`),
    ];
    if (name.includes('/')) {
      candidates.unshift(join(stylesRoot, `${name}.scss`));
    }
    for (const p of candidates) {
      if (existsSync(p) && !paths.includes(p)) paths.push(p);
    }
  }
  return paths;
}

function getVarPrefixes(folder) {
  const prefixes = new Set([folder]);
  for (const p of FOLDER_VAR_PREFIXES[folder] ?? []) prefixes.add(p);
  const first = folder.split('-')[0];
  if (first !== folder) prefixes.add(first);
  return [...prefixes];
}

function categorizeVar(name, resolved, design) {
  const { value, tokenRef } = resolved;
  if (!value || SKIP_VALUES.has(String(value))) return;

  const ref = tokenRef ?? `$${name}`;
  const n = name.toLowerCase();

  if (n.includes('shadow') || n.includes('box-shadow')) {
    pushUnique(design.elevation, { name, value: String(value), tokenRef: ref });
  } else if (n.includes('radius')) {
    pushUnique(design.radius, { name, value: String(value), tokenRef: ref });
  } else if (n.includes('font') || n.includes('line-height') || n.includes('letter-spacing')) {
    pushUnique(design.typography, { name, value: String(value), tokenRef: ref });
  } else if (
    n.includes('color') ||
    n.includes('-bg') ||
    n.endsWith('-bg') ||
    n.includes('background') ||
    n.includes('border-color') ||
    n.includes('divider-color')
  ) {
    pushUnique(design.colors, { name, value: String(value), tokenRef: ref });
  } else if (
    n.includes('padding') ||
    n.includes('margin') ||
    n.includes('width') ||
    n.includes('height') ||
    n.includes('gap') ||
    n.includes('spacer')
  ) {
    pushUnique(design.spacing, { name, value: String(value), tokenRef: ref });
  }
}

function extractPrefixVariables(folder, ctx) {
  const design = emptyDesign();
  const prefixes = getVarPrefixes(folder);
  for (const [name] of ctx.resolver.scssVars) {
    if (!prefixes.some((p) => name === p || name.startsWith(`${p}-`))) continue;
    const resolved = ctx.resolver.resolve(`$${name}`);
    categorizeVar(name, resolved, design);
  }
  return design;
}

function extractFromScssContent(content, ctx) {
  const design = emptyDesign();

  for (const m of content.matchAll(/(?:color|background(?:-color)?|border-color|fill)\s*:\s*([^;{]+)/g)) {
    const raw = m[1].trim();
    if (SKIP_VALUES.has(raw)) continue;
    const resolved = ctx.resolver.resolve(raw.startsWith('$') ? raw : raw);
    pushUnique(design.colors, {
      name: `color-${design.colors.length + 1}`,
      value: resolved.value,
      tokenRef: resolved.tokenRef ?? (raw.startsWith('$') ? raw : null),
    });
  }

  for (const m of content.matchAll(
    /(?:padding(?:-x|-y|-top|-bottom|-left|-right)?|margin(?:-x|-y|-top|-bottom|-left|-right)?|gap|min-height|max-height|height|width)\s*:\s*([^;{]+)/g,
  )) {
    const prop = m[0].split(':')[0].trim();
    const raw = m[1].trim();
    const resolved = ctx.resolver.resolve(raw.startsWith('$') ? raw : raw);
    pushUnique(design.spacing, {
      name: prop,
      value: resolved.value,
      tokenRef: resolved.tokenRef ?? (raw.startsWith('$') ? raw : `literal:${prop}`),
    });
  }

  for (const m of content.matchAll(/border-radius\s*:\s*([^;{]+)/g)) {
    const raw = m[1].trim();
    const resolved = ctx.resolver.resolve(raw.startsWith('$') ? raw : raw);
    pushUnique(design.radius, {
      name: 'border-radius',
      value: resolved.value,
      tokenRef: resolved.tokenRef ?? (raw.startsWith('$') ? raw : null),
    });
  }

  for (const m of content.matchAll(/(?:font-size|font-weight|line-height|letter-spacing|font-family)\s*:\s*([^;{]+)/g)) {
    const prop = m[0].split(':')[0].trim();
    const raw = m[1].trim();
    const resolved = ctx.resolver.resolve(raw.startsWith('$') ? raw : raw);
    pushUnique(design.typography, {
      name: prop,
      value: resolved.value,
      tokenRef: resolved.tokenRef ?? (raw.startsWith('$') ? raw : null),
    });
  }

  for (const m of content.matchAll(/box-shadow\s*:\s*([^;{]+)/g)) {
    const raw = m[1].trim();
    const resolved = ctx.resolver.resolve(raw.startsWith('$') ? raw : raw);
    pushUnique(design.elevation, {
      name: 'box-shadow',
      value: resolved.value,
      tokenRef: resolved.tokenRef ?? (raw.startsWith('$') ? raw : null),
    });
  }

  if (/:hover/.test(content)) pushUnique(design.states, { name: 'hover', notes: 'Detected in stylesheet' });
  if (/:focus|:focus-visible/.test(content)) pushUnique(design.states, { name: 'focus', notes: 'Detected in stylesheet' });
  if (/:disabled|\.disabled/.test(content)) pushUnique(design.states, { name: 'disabled', notes: 'Detected in stylesheet' });

  return design;
}

function parseThemeColorMap(mapVarName, ctx) {
  const design = emptyDesign();
  const escaped = mapVarName.replace(/\$/g, '\\$');
  const re = new RegExp(`${escaped}:\\s*\\(([\\s\\S]*?)\\)\\s*!default`);
  const match = ctx.variablesScss.match(re);
  if (!match) return design;

  const variantRe = /"([\w-]+)":\s*\(\s*"([\w-]+)":\s*\$([\w-]+)/g;
  let m;
  while ((m = variantRe.exec(match[1])) !== null) {
    const [, variant, prop, varName] = m;
    const resolved = ctx.resolver.resolve(`$${varName}`);
    pushUnique(design.colors, {
      name: `${variant}-${prop}`,
      value: String(resolved.value),
      tokenRef: resolved.tokenRef ?? `$${varName}`,
    });
  }
  return design;
}

function extractClassLiterals(source) {
  const classes = new Set();

  for (const m of source.matchAll(/(?:bg|text|border|alert|filter-tag)-[\w-]+/g)) {
    classes.add(m[0]);
  }
  for (const m of source.matchAll(/(?:badge-lg|badge-sm|loader-[\w-]+|nav-tabs[\w-]*|page-layout-[\w-]+)/g)) {
    classes.add(m[0]);
  }
  for (const m of source.matchAll(/['"`]([a-z][a-z0-9-]*(?:\s+[a-z][a-z0-9-]*)*)['"`]/gi)) {
    for (const cls of m[1].split(/\s+/)) {
      if (/^(bg|text|border|alert|filter-tag|badge|loader|btn|link|progress|breadcrumb|offcanvas|avatar|nav-tabs|page-layout)/.test(cls)) {
        classes.add(cls);
      }
    }
  }
  for (const m of source.matchAll(/class\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/)) {
      if (cls && !/^\{/.test(cls)) classes.add(cls);
    }
  }
  for (const m of source.matchAll(/\[ngClass\]\s*=\s*["']([^"']+)["']/g)) {
    for (const cls of m[1].split(/\s+/)) classes.add(cls);
  }
  return [...classes];
}

function resolveUtilityClass(className, ctx) {
  const design = emptyDesign();

  let tokenName = null;
  if (className.startsWith('bg-')) tokenName = className.slice(3);
  else if (className.startsWith('text-')) tokenName = className.slice(5);
  else if (className.startsWith('border-')) tokenName = className.slice(7);

  if (tokenName) {
    const hex = ctx.resolver.tokenHex.get(tokenName);
    const scssVar = `$${tokenName.replace(/-/g, '-')}`;
    const resolved = hex
      ? { value: hex, tokenRef: tokenName }
      : ctx.resolver.resolve(scssVar);
    const bucket = className.startsWith('text-') ? 'typography' : 'colors';
    if (bucket === 'colors') {
      pushUnique(design.colors, { name: className, value: String(resolved.value), tokenRef: resolved.tokenRef ?? tokenName });
    } else {
      pushUnique(design.typography, { name: className, value: String(resolved.value), tokenRef: resolved.tokenRef ?? tokenName });
    }
    return design;
  }

  const alertMatch = className.match(/^alert-([\w-]+)$/);
  if (alertMatch) {
    const variant = alertMatch[1];
    const themeDesign = parseThemeColorMap('$theme-alert-colors', ctx);
    for (const c of themeDesign.colors.filter((x) => x.name.startsWith(`${variant}-`))) {
      pushUnique(design.colors, { ...c, name: `${className}-${c.name.split('-').slice(1).join('-')}` });
    }
    return design;
  }

  const tagMatch = className.match(/^filter-tag-([\w-]+)$/);
  if (tagMatch && tagMatch[1] !== 'sm' && tagMatch[1] !== 'lg') {
    const variant = tagMatch[1];
    const themeDesign = parseThemeColorMap('$theme-tag-colors', ctx);
    const bg = themeDesign.colors.find((x) => x.name === `${variant}-background`);
    if (bg) pushUnique(design.colors, { name: className, value: bg.value, tokenRef: bg.tokenRef });
    return design;
  }

  return design;
}

function readSiblingHtml(tsFilePath) {
  const htmlPath = tsFilePath.replace(/\.component\.ts$/, '.component.html');
  return existsSync(htmlPath) ? readFileSync(htmlPath, 'utf8') : '';
}

/**
 * @param {{ tsFilePath: string, folder: string, cgRepoRoot: string }} opts
 */
export function extractCgComponentDesign({ tsFilePath, folder, cgRepoRoot }) {
  const ctx = createCgDesignContext(cgRepoRoot);
  let design = extractDesignFromStyles(tsFilePath);

  const tsContent = readFileSync(tsFilePath, 'utf8');
  const htmlContent = readSiblingHtml(tsFilePath);
  const combinedSource = `${tsContent}\n${htmlContent}`;

  for (const partialPath of findStylePartials(folder, ctx.stylesRoot)) {
    const content = readFileSync(partialPath, 'utf8');
    if (content.trim()) {
      design = mergeDesignAccumulate(design, extractFromScssContent(content, ctx));
    }
  }

  design = mergeDesignAccumulate(design, extractPrefixVariables(folder, ctx));

  const themeMap = FOLDER_THEME_MAPS[folder];
  if (themeMap) {
    design = mergeDesignAccumulate(design, parseThemeColorMap(themeMap, ctx));
  }

  for (const className of extractClassLiterals(combinedSource)) {
    design = mergeDesignAccumulate(design, resolveUtilityClass(className, ctx));
  }

  return design;
}

export function resetCgDesignContextCache() {
  cachedContext = null;
}
