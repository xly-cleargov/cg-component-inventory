/** Figma file landing nodes — prefer component pages over these when mapped. */
export const FIGMA_FILE_ROOT_NODES = new Set([
  '5344-1363', '5344:1363',
  '4653-10511', '4653:10511',
  '1-2', '1:2',
]);

export function isFileRootUrl(url) {
  if (!url) return false;
  const match = url.match(/node-id=([^&]+)/i);
  if (!match) return false;
  return FIGMA_FILE_ROOT_NODES.has(decodeURIComponent(match[1]));
}

export function isComponentFigmaNodeUrl(url) {
  if (!url) return false;
  const match = url.match(/node-id=([^&]+)/i);
  if (!match) return false;
  return !FIGMA_FILE_ROOT_NODES.has(decodeURIComponent(match[1]));
}

export function figmaDesignUrl(baseUrl, nodeId) {
  const dashed = nodeId.replace(':', '-');
  return `${baseUrl}?node-id=${dashed}`;
}

export function applyManifestToRaw(raw, manifest, { label = 'Figma' } = {}) {
  if (!manifest?.components || !raw?.components) return 0;

  let applied = 0;
  for (const comp of raw.components) {
    const nodeId = manifest.components[comp.id];
    if (!nodeId) continue;

    const url = figmaDesignUrl(manifest.baseUrl, nodeId);
    const existing = comp.designMeta?.figmaUrl;
    if (existing && isComponentFigmaNodeUrl(existing)) continue;

    comp.designMeta = {
      ...(comp.designMeta ?? {}),
      source: comp.designMeta?.source ?? 'figma',
      library: comp.designMeta?.library ?? `${label} — component page`,
      figmaUrl: url,
      notes: comp.designMeta?.notes ?? `Figma component page for ${comp.id}`,
    };
    applied++;
  }
  return applied;
}
