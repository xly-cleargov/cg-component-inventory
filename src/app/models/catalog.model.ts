export type AppCode = 'cg' | 'ds' | 'es';
export type ComponentCategory =
  | 'action'
  | 'form'
  | 'feedback'
  | 'navigation'
  | 'layout'
  | 'data'
  | 'overlay'
  | 'media'
  | 'typography'
  | 'other';

export type GapKind = 'presence' | 'api' | 'design' | 'a11y' | 'service';
export type GapSeverity = 'low' | 'medium' | 'high' | 'blocker';
export type PresenceStatus = 'present' | 'missing' | 'partial' | 'n/a';
export type MigrateHint = 'swap' | 'adapt' | 'rewrite' | 'keep' | 'new-needed' | 'unknown';

export interface DesignValue {
  name: string;
  value: string;
  tokenRef?: string | null;
}

export interface PropDef {
  name: string;
  type: string;
  default?: unknown;
  required?: boolean;
  values?: string[];
  description?: string;
}

export interface EventDef {
  name: string;
  payloadType?: string;
  description?: string;
}

export interface SlotDef {
  name: string;
  description?: string;
}

export interface MethodDef {
  name: string;
  signature?: string;
  description?: string;
}

export interface ServiceDef {
  name: string;
  methods?: string[];
  description?: string;
}

export interface ComponentApi {
  props?: PropDef[];
  events?: EventDef[];
  slots?: SlotDef[];
  methods?: MethodDef[];
  services?: ServiceDef[];
}

export interface ComponentDesign {
  colors?: DesignValue[];
  spacing?: DesignValue[];
  radius?: DesignValue[];
  typography?: DesignValue[];
  elevation?: DesignValue[];
  states?: { name: string; notes?: string }[];
}

export interface DesignMeta {
  source?: 'figma' | 'code' | 'mixed';
  library?: string;
  figmaUrl?: string;
  enrichedAt?: string;
  notes?: string;
}

export interface ComponentUsage {
  instanceCount?: number | null;
  fileCount?: number | null;
  samplePaths?: string[];
}

export interface Implementation {
  id: string;
  displayName: string;
  category?: ComponentCategory;
  framework: string;
  packageOrPath?: string;
  selectorOrExport?: string;
  usage?: ComponentUsage;
  api?: ComponentApi;
  design?: ComponentDesign;
  designMeta?: DesignMeta;
  a11y?: { role?: string | null; labelProps?: string[]; notes?: string };
  migrateHint?: MigrateHint;
  confidence?: string;
  notes?: string;
}

export interface Gap {
  id: string;
  kind: GapKind;
  severity: GapSeverity;
  summary: string;
  apps?: Partial<Record<AppCode, PresenceStatus>>;
  details?: string;
}

export interface ComponentFamily {
  id: string;
  label: string;
  category: ComponentCategory;
  description?: string;
  implementations: Partial<Record<AppCode, Implementation>>;
  gaps?: Gap[];
}

export interface CatalogMeta {
  version: string;
  generatedAt: string;
  sources: Partial<Record<AppCode, { repoOrPackage?: string; ref?: string; figmaUrl?: string; status?: string; notes?: string }>>;
  designCoverage?: { familiesWithDesign: number; familiesTotal: number; enrichedComponents?: number };
  notes?: string;
}

export interface ComponentCatalog {
  meta: CatalogMeta;
  families: ComponentFamily[];
  unresolvedMappings?: { source: AppCode; sourceId: string; reason: string }[];
}

export interface RawInventory {
  source: AppCode;
  extractedAt: string;
  origin: { repoOrPackage?: string; ref?: string; figmaUrl?: string; notes?: string };
  components: Implementation[];
  familiesGuess?: Record<string, string>;
}

export const APP_LABELS: Record<AppCode, string> = {
  cg: 'ClearGov 1.0',
  ds: 'Disclosure Studio',
  es: 'Engagement Studio',
};

export const APP_CODES: AppCode[] = ['cg', 'ds', 'es'];

export const CATEGORY_LABELS: Record<ComponentCategory, string> = {
  action: 'Action',
  form: 'Form',
  feedback: 'Feedback',
  navigation: 'Navigation',
  layout: 'Layout',
  data: 'Data',
  overlay: 'Overlay',
  media: 'Media',
  typography: 'Typography',
  other: 'Other',
};
