/**
 * Canonical family IDs for cross-app comparison.
 * Alternate IDs (from CG auto-naming or legacy DS maps) resolve to one family.
 */

/** source component id → canonical family id (CG) */
export const CG_TO_FAMILY = {
  'cg-tab': 'tabs',
  'cg-navbar-item': 'navbar',
  'cg-tooltip-help': 'tooltip',
  'cg-toast-content': 'toast',
  'cg-breadcrumbs': 'breadcrumb',
};

/** legacy/alternate family id → canonical family id */
export const FAMILY_ALIASES = {
  toggle: 'switch',
  tab: 'tabs',
  'navbar-item': 'navbar',
  'tooltip-help': 'tooltip',
  'toast-content': 'toast',
  breadcrumbs: 'breadcrumb',
};

export function resolveFamilyId(familyId) {
  return FAMILY_ALIASES[familyId] ?? familyId;
}

export function familyIdFromCg(sourceId) {
  if (CG_TO_FAMILY[sourceId]) return CG_TO_FAMILY[sourceId];
  return resolveFamilyId(sourceId.replace(/^cg-/, '').replace(/-service$/, ''));
}

/** Prefer the best single implementation when multiple source rows map to the same app slot. */
export function pickImplementation(existing, candidate, source) {
  if (!existing) return candidate;
  if (source === 'ds') {
    const score = (impl) => {
      let s = 0;
      if (impl.framework === 'devextreme') s += 1000;
      if (impl.framework === 'design-system') s += 500;
      s += impl.usage?.instanceCount ?? 0;
      return s;
    };
    return score(candidate) > score(existing) ? candidate : existing;
  }
  return existing;
}
