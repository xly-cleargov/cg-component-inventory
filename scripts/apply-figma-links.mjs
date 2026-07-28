#!/usr/bin/env node
/**
 * Attach component-specific Figma URLs to cg/ds/es raw inventories from manifest JSON.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyManifestToRaw } from './figma-link-utils.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');

const MANIFESTS = [
  { source: 'cg', file: 'cg-figma-components.json', label: 'ClearGov Design System — COMPONENTS' },
  { source: 'ds', file: 'ds-figma-components.json', label: 'Gravity design foundations' },
  { source: 'es', file: 'es-figma-components.json', label: 'Community Design System' },
];

export function applyFigmaLinks({ writeRaw = true } = {}) {
  let total = 0;

  for (const { source, file, label } of MANIFESTS) {
    const manifestPath = join(dataDir, file);
    const rawPath = join(dataDir, 'sources', `${source}.raw.json`);
    if (!existsSync(manifestPath) || !existsSync(rawPath)) continue;

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
    const applied = applyManifestToRaw(raw, manifest, { label });

    if (applied && writeRaw) {
      writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
    }

    if (applied) {
      console.log(`Applied ${source.toUpperCase()} Figma component links to ${applied} component(s)`);
    }
    total += applied;
  }

  return { applied: total };
}

/** @deprecated Use applyFigmaLinks */
export function applyCgFigmaLinks(opts) {
  return applyFigmaLinks(opts);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyFigmaLinks({ writeRaw: true });
}
