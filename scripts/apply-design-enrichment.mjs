#!/usr/bin/env node
/**
 * Merges data/design-enrichment/enrichment.json into raw source inventories.
 * Called by build-catalog.mjs before catalog assembly.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');
const enrichmentPath = join(dataDir, 'design-enrichment', 'enrichment.json');

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function deepMergeDesign(existing, incoming) {
  const out = { ...existing };
  for (const key of ['colors', 'spacing', 'radius', 'typography', 'elevation', 'states']) {
    if (incoming[key]?.length) {
      out[key] = incoming[key];
    }
  }
  return out;
}

export function applyDesignEnrichment({ writeRaw = true } = {}) {
  if (!existsSync(enrichmentPath)) {
    console.log('No design enrichment file — skipping');
    return { applied: 0 };
  }

  const enrichment = loadJson(enrichmentPath);
  const bySource = { cg: new Map(), ds: new Map(), es: new Map() };

  for (const entry of enrichment.entries ?? []) {
    bySource[entry.source]?.set(entry.sourceId, entry);
  }

  let applied = 0;

  for (const src of ['cg', 'ds', 'es']) {
    const rawPath = join(dataDir, 'sources', `${src}.raw.json`);
    if (!existsSync(rawPath)) continue;

    const raw = loadJson(rawPath);
    const map = bySource[src];
    if (!map.size) continue;

    let changed = false;
    for (const comp of raw.components) {
      const entry = map.get(comp.id);
      if (!entry) continue;

      comp.design = deepMergeDesign(comp.design ?? {}, entry.design);
      if (entry.designMeta) {
        comp.designMeta = { ...entry.designMeta, enrichedAt: enrichment.enrichedAt };
      }
      applied++;
      changed = true;
    }

    if (changed && writeRaw) {
      writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
    }
  }

  console.log(`Applied design enrichment to ${applied} component(s)`);
  return { applied, enrichedAt: enrichment.enrichedAt };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyDesignEnrichment({ writeRaw: true });
}
