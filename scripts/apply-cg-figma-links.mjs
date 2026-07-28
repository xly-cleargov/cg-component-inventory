#!/usr/bin/env node
/**
 * Attach ClearGov Design System COMPONENTS page Figma URLs to CG raw inventory.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data');
const manifestPath = join(dataDir, 'cg-figma-components.json');

/** Figma file landing nodes — not component pages. */
const FILE_ROOT_NODES = new Set([
  '5344-1363', '5344:1363',
  '4653-10511', '4653:10511',
  '1-2', '1:2',
]);

function isFileRootUrl(url) {
  if (!url) return false;
  const match = url.match(/node-id=([^&]+)/i);
  if (!match) return false;
  return FILE_ROOT_NODES.has(decodeURIComponent(match[1]));
}

function figmaDesignUrl(baseUrl, nodeId) {
  const dashed = nodeId.replace(':', '-');
  return `${baseUrl}?node-id=${dashed}`;
}

export function applyCgFigmaLinks({ writeRaw = true } = {}) {
  if (!existsSync(manifestPath)) {
    console.log('No cg-figma-components.json — skipping CG Figma links');
    return { applied: 0 };
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const rawPath = join(dataDir, 'sources', 'cg.raw.json');
  if (!existsSync(rawPath)) return { applied: 0 };

  const raw = JSON.parse(readFileSync(rawPath, 'utf8'));
  let applied = 0;

  for (const comp of raw.components) {
    const nodeId = manifest.components?.[comp.id];
    if (!nodeId) continue;

    const url = figmaDesignUrl(manifest.baseUrl, nodeId);
    const existing = comp.designMeta?.figmaUrl;
    if (existing && !isFileRootUrl(existing)) continue;

    comp.designMeta = {
      ...(comp.designMeta ?? {}),
      source: comp.designMeta?.source ?? 'figma',
      library: comp.designMeta?.library ?? 'ClearGov Design System — COMPONENTS',
      figmaUrl: url,
      notes: comp.designMeta?.notes ?? 'Figma COMPONENTS page for this cg-* primitive',
    };
    applied++;
  }

  if (applied && writeRaw) {
    writeFileSync(rawPath, JSON.stringify(raw, null, 2) + '\n');
  }

  console.log(`Applied CG Figma component links to ${applied} component(s)`);
  return { applied };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  applyCgFigmaLinks({ writeRaw: true });
}
