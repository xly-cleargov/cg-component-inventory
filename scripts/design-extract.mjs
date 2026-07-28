/**
 * Extract design values from component styles (CG SCSS) or Tailwind classes (ES React).
 */
import { existsSync, readFileSync } from 'node:fs';

const HEX_RE = /^#([0-9a-f]{3,8})$/i;
const SKIP_VALUES = new Set(['inherit', 'transparent', 'none', 'auto', 'unset', 'initial']);

function pushUnique(arr, item, limit = 20) {
  if (arr.length >= limit) return;
  if (arr.some((x) => x.name === item.name && x.value === item.value)) return;
  arr.push(item);
}

function tokenRefFromRaw(raw) {
  const trimmed = raw.trim();
  const varMatch = trimmed.match(/var\((--[^,)]+)/);
  if (varMatch) return varMatch[1];
  const scssMatch = trimmed.match(/\$([a-zA-Z0-9_-]+)/);
  if (scssMatch) return `$${scssMatch[1]}`;
  return null;
}

function normalizeValue(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

export function extractDesignFromStyles(tsFilePath) {
  const base = tsFilePath.replace(/\.component\.ts$/, '').replace(/\.ts$/, '');
  const candidates = [
    `${base}.component.scss`,
    `${base}.scss`,
    `${base}.component.less`,
    `${base}.component.css`,
  ];

  const design = {
    colors: [],
    spacing: [],
    radius: [],
    typography: [],
    elevation: [],
    states: [],
  };

  for (const stylePath of candidates) {
    if (!existsSync(stylePath)) continue;
    const content = readFileSync(stylePath, 'utf8');

    for (const m of content.matchAll(/(?:color|background(?:-color)?|border-color|fill)\s*:\s*([^;]+);/g)) {
      const value = normalizeValue(m[1]);
      if (SKIP_VALUES.has(value)) continue;
      pushUnique(design.colors, {
        name: `color-${design.colors.length + 1}`,
        value,
        tokenRef: tokenRefFromRaw(value),
      });
    }

    for (const m of content.matchAll(
      /(?:padding(?:-x|-y|-top|-bottom|-left|-right)?|margin(?:-x|-y|-top|-bottom|-left|-right)?|gap|min-height|max-height|height|width)\s*:\s*([^;]+);/g,
    )) {
      const prop = m[0].split(':')[0].trim();
      const value = normalizeValue(m[1]);
      pushUnique(design.spacing, { name: prop, value, tokenRef: tokenRefFromRaw(value) });
    }

    for (const m of content.matchAll(/border-radius\s*:\s*([^;]+);/g)) {
      const value = normalizeValue(m[1]);
      pushUnique(design.radius, { name: 'border-radius', value, tokenRef: tokenRefFromRaw(value) });
    }

    for (const m of content.matchAll(
      /(?:font-size|font-weight|line-height|letter-spacing|font-family)\s*:\s*([^;]+);/g,
    )) {
      const prop = m[0].split(':')[0].trim();
      const value = normalizeValue(m[1]);
      pushUnique(design.typography, { name: prop, value, tokenRef: tokenRefFromRaw(value) });
    }

    for (const m of content.matchAll(/box-shadow\s*:\s*([^;]+);/g)) {
      const value = normalizeValue(m[1]);
      pushUnique(design.elevation, { name: 'box-shadow', value, tokenRef: tokenRefFromRaw(value) });
    }

    if (/:hover/.test(content)) {
      pushUnique(design.states, { name: 'hover', notes: 'Detected in stylesheet' });
    }
    if (/:focus|:focus-visible/.test(content)) {
      pushUnique(design.states, { name: 'focus', notes: 'Detected in stylesheet' });
    }
    if (/:disabled|\.disabled/.test(content)) {
      pushUnique(design.states, { name: 'disabled', notes: 'Detected in stylesheet' });
    }

    break;
  }

  return design;
}

const TAILWIND_COLOR = /\b(?:bg|text|border|ring|from|to|via)-([a-z0-9-]+(?:\/\d+)?)\b/g;
const TAILWIND_SPACING = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|gap|space-x|space-y|min-h|max-h|h|w)-([a-z0-9.[\]/]+)\b/g;
const TAILWIND_RADIUS = /\brounded(-[a-z0-9]+)?\b/g;
const TAILWIND_TYPO = /\b(?:text-(?:xs|sm|base|lg|xl|2xl|3xl|[0-9]+xl)|font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black))\b/g;
const TAILWIND_SHADOW = /\bshadow(-[a-z0-9]+)?\b/g;

export function extractDesignFromTailwind(content) {
  const design = {
    colors: [],
    spacing: [],
    radius: [],
    typography: [],
    elevation: [],
    states: [],
  };

  const classChunks = [...content.matchAll(/className\s*=\s*(?:\{`([^`]+)`\}|"([^"]+)"|'([^']+)')/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '')
    .join(' ');

  for (const m of classChunks.matchAll(TAILWIND_COLOR)) {
    pushUnique(design.colors, { name: m[0], value: m[0], tokenRef: null });
  }
  for (const m of classChunks.matchAll(TAILWIND_SPACING)) {
    pushUnique(design.spacing, { name: m[0], value: m[0], tokenRef: null });
  }
  for (const m of classChunks.matchAll(TAILWIND_RADIUS)) {
    pushUnique(design.radius, { name: m[0], value: m[0], tokenRef: null });
  }
  for (const m of classChunks.matchAll(TAILWIND_TYPO)) {
    pushUnique(design.typography, { name: m[0], value: m[0], tokenRef: null });
  }
  for (const m of classChunks.matchAll(TAILWIND_SHADOW)) {
    pushUnique(design.elevation, { name: m[0], value: m[0], tokenRef: null });
  }

  if (/\bhover:/.test(classChunks)) {
    pushUnique(design.states, { name: 'hover', notes: 'Tailwind hover: utilities' });
  }
  if (/\bfocus:/.test(classChunks)) {
    pushUnique(design.states, { name: 'focus', notes: 'Tailwind focus: utilities' });
  }
  if (/\bdisabled:/.test(classChunks) || /\bdisabled\b/.test(content)) {
    pushUnique(design.states, { name: 'disabled', notes: 'Disabled prop or utility' });
  }

  return design;
}

export function hasTangibleDesign(design, designMeta) {
  if (designMeta?.enrichedAt) return true;
  if (!design) return false;
  if ((design.colors?.length ?? 0) > 0) return true;
  if ((design.radius?.length ?? 0) > 0) return true;
  if ((design.typography?.length ?? 0) > 0) return true;
  if ((design.elevation?.length ?? 0) > 0) return true;
  const spacing = design.spacing ?? [];
  if (spacing.some((t) => t.tokenRef)) return true;
  if (spacing.some((t) => /^\d/.test(String(t.value)) || String(t.value).endsWith('px') || String(t.value).endsWith('rem'))) {
    return true;
  }
  return false;
}

export function hasDesignData(design, designMeta) {
  return hasTangibleDesign(design, designMeta);
}

export function mergeDesign(base, extra) {
  const out = { ...base };
  for (const key of ['colors', 'spacing', 'radius', 'typography', 'elevation', 'states']) {
    if (extra[key]?.length) {
      out[key] = extra[key];
    }
  }
  return out;
}

export function isHexColor(value) {
  return HEX_RE.test(value);
}
