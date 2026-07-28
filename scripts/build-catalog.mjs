#!/usr/bin/env node
/**
 * Builds catalog.json from raw source inventories + crosswalk, then syncs to public/data/.
 * Pass --sync-only to skip catalog regeneration and only copy data/ → public/data/.
 */
import { readFileSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDesignEnrichment } from './apply-design-enrichment.mjs';
import { applyCgFigmaLinks } from './apply-cg-figma-links.mjs';
import { hasTangibleDesign } from './design-extract.mjs';
import { pickImplementation } from './family-aliases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');
const syncOnly = process.argv.includes('--sync-only');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function indexComponents(raw) {
  const map = new Map();
  for (const c of raw.components) {
    map.set(c.id, c);
  }
  return map;
}

function propNames(impl) {
  return new Set((impl?.api?.props ?? []).map((p) => p.name));
}

function designTokens(impl) {
  const tokens = new Map();
  for (const group of ['colors', 'spacing', 'radius', 'typography', 'elevation']) {
    for (const v of impl?.design?.[group] ?? []) {
      tokens.set(`${group}:${v.name}`, v.value);
    }
  }
  return tokens;
}

function computeDesignGaps(familyId, implementations) {
  const gaps = [];
  const apps = ['cg', 'ds', 'es'];
  const present = apps.filter((a) => implementations[a]);
  if (present.length < 2) return gaps;

  const allKeys = new Map();
  for (const app of present) {
    for (const [key, value] of designTokens(implementations[app])) {
      if (!allKeys.has(key)) allKeys.set(key, {});
      allKeys.get(key)[app] = value;
    }
  }

  for (const [key, valuesByApp] of allKeys) {
    const appsWith = present.filter((a) => valuesByApp[a] != null);
    const missing = present.filter((a) => valuesByApp[a] == null);
    const uniqueValues = new Set(appsWith.map((a) => valuesByApp[a]));
    if (missing.length > 0 && appsWith.length > 0) {
      gaps.push({
        id: `${familyId}.design.${key.replace(':', '.')}.missing`,
        kind: 'design',
        severity: 'medium',
        summary: `Design "${key}" documented in ${appsWith.join(', ')} but missing in ${missing.join(', ')}`,
        apps: Object.fromEntries(
          apps.map((a) => [a, appsWith.includes(a) ? 'present' : implementations[a] ? 'missing' : 'n/a']),
        ),
        details: 'Auto-detected design token presence gap',
      });
    } else if (uniqueValues.size > 1 && appsWith.length > 1) {
      gaps.push({
        id: `${familyId}.design.${key.replace(':', '.')}.value`,
        kind: 'design',
        severity: 'high',
        summary: `Design "${key}" differs across apps: ${appsWith.map((a) => `${a}=${valuesByApp[a]}`).join('; ')}`,
        apps: Object.fromEntries(apps.map((a) => [a, appsWith.includes(a) ? 'present' : 'n/a'])),
        details: 'Auto-detected design value mismatch',
      });
    }
  }

  return gaps;
}

function computePropGaps(familyId, implementations) {
  const gaps = [];
  const apps = ['cg', 'ds', 'es'];
  const present = apps.filter((a) => implementations[a]);
  if (present.length < 2) return gaps;

  const allProps = new Map();
  for (const app of present) {
    for (const name of propNames(implementations[app])) {
      if (!allProps.has(name)) allProps.set(name, []);
      allProps.get(name).push(app);
    }
  }

  for (const [prop, appsWith] of allProps) {
    const missing = present.filter((a) => !appsWith.includes(a));
    if (missing.length > 0 && appsWith.length > 0) {
      gaps.push({
        id: `${familyId}.prop.${prop}`,
        kind: 'api',
        severity: 'medium',
        summary: `Prop "${prop}" present in ${appsWith.join(', ')} but missing in ${missing.join(', ')}`,
        apps: Object.fromEntries(
          apps.map((a) => [a, appsWith.includes(a) ? 'present' : implementations[a] ? 'missing' : 'n/a'])
        ),
        details: `Auto-detected prop presence gap`,
      });
    }
  }
  return gaps;
}

function computeCategoryGaps(familyId, implementations) {
  const apps = ['cg', 'ds', 'es'];
  const present = apps.filter((a) => implementations[a]);
  if (present.length < 2) return [];

  const byApp = Object.fromEntries(present.map((a) => [a, implementations[a].category]));
  const unique = new Set(Object.values(byApp));
  if (unique.size <= 1) return [];

  return [
    {
      id: `${familyId}.category.mismatch`,
      kind: 'taxonomy',
      severity: 'low',
      summary: `Category differs across apps: ${present.map((a) => `${a}=${byApp[a]}`).join('; ')}`,
      apps: Object.fromEntries(apps.map((a) => [a, implementations[a] ? 'present' : 'n/a'])),
      details: 'Same component family classified under different inventory categories per app.',
    },
  ];
}

const DESIGN_GROUPS = ['colors', 'spacing', 'radius', 'typography', 'elevation'];

function hasDesignValues(design, designMeta) {
  return hasTangibleDesign(design, designMeta);
}

function buildCatalog() {
  const cg = loadJson(join(dataDir, 'sources', 'cg.raw.json'));
  const ds = loadJson(join(dataDir, 'sources', 'ds.raw.json'));
  const es = loadJson(join(dataDir, 'sources', 'es.raw.json'));
  const crosswalk = loadJson(join(dataDir, 'crosswalk.json'));

  const sources = { cg: indexComponents(cg), ds: indexComponents(ds), es: indexComponents(es) };

  const familyMap = new Map();
  for (const m of crosswalk.mappings) {
    if (!familyMap.has(m.familyId)) {
      familyMap.set(m.familyId, { id: m.familyId, implementations: {}, gaps: [] });
    }
    const comp = sources[m.source].get(m.sourceId);
    if (comp) {
      const slot = familyMap.get(m.familyId).implementations;
      slot[m.source] = pickImplementation(slot[m.source], comp, m.source);
    }
  }

  const families = [];
  for (const [familyId, family] of familyMap) {
    const label = family.implementations.cg?.displayName
      ?? family.implementations.ds?.displayName
      ?? family.implementations.es?.displayName
      ?? familyId;
    const category = family.implementations.cg?.category
      ?? family.implementations.ds?.category
      ?? family.implementations.es?.category
      ?? 'other';

    const autoGaps = [
      ...computeCategoryGaps(familyId, family.implementations),
      ...computePropGaps(familyId, family.implementations),
      ...computeDesignGaps(familyId, family.implementations),
    ];

    families.push({
      id: familyId,
      label,
      category,
      description: `${label} — cross-app comparison`,
      implementations: family.implementations,
      gaps: autoGaps,
    });
  }

  families.sort((a, b) => a.label.localeCompare(b.label));

  const sourceOrigins = { cg: cg.origin, ds: ds.origin, es: es.origin };

  const familiesWithDesign = families.filter((f) =>
    ['cg', 'ds', 'es'].some((app) => hasDesignValues(f.implementations[app]?.design, f.implementations[app]?.designMeta)),
  ).length;

  const catalog = {
    meta: {
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
      sources: {
        cg: { ...cg.origin, status: 'extracted' },
        ds: { ...ds.origin, status: 'extracted' },
        es: { ...es.origin, status: 'extracted' },
      },
      designCoverage: {
        familiesWithDesign,
        familiesTotal: families.length,
        enrichedComponents: familiesWithDesign,
      },
      notes: 'Auto-generated by scripts/build-catalog.mjs. Manual gaps in catalog.json may be overwritten — merge carefully.',
    },
    families,
    unresolvedMappings: [],
  };

  writeFileSync(join(dataDir, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  console.log(`Wrote catalog.json with ${families.length} families`);
}

function syncToPublic() {
  const publicData = join(root, 'public', 'data');
  const publicSources = join(publicData, 'sources');
  mkdirSync(publicSources, { recursive: true });
  for (const file of ['catalog.json', 'crosswalk.json']) {
    cpSync(join(dataDir, file), join(publicData, file));
  }
  for (const src of ['cg', 'ds', 'es']) {
    cpSync(join(dataDir, 'sources', `${src}.raw.json`), join(publicSources, `${src}.raw.json`));
  }
  console.log('Synced data/ → public/data/');
}

if (!syncOnly) {
  applyDesignEnrichment({ writeRaw: true });
  applyCgFigmaLinks({ writeRaw: true });
  buildCatalog();
}
syncToPublic();
