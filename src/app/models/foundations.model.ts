import { AppCode } from './catalog.model';

export type FoundationSection = 'colors' | 'typography' | 'spacing';

export interface TypographyDetail {
  displayName?: string;
  size?: string;
  lineHeight?: string;
  weight?: string;
  letterSpacing?: string | null;
}

export interface FoundationAppValue {
  value: string | null;
  tokenRef?: string | null;
  /** CG token name shown in UI, e.g. blue-60 or body-01 */
  nativeName?: string | null;
  typographyDetail?: TypographyDetail;
}

export interface FoundationToken {
  id: string;
  label: string;
  apps: Partial<Record<AppCode, FoundationAppValue>>;
  /** CG palette step with no DS/ES mapped equivalent — shown at page bottom */
  cgOnly?: boolean;
}

export interface FoundationGroup {
  id: string;
  label: string;
  tokens: FoundationToken[];
}

export interface FoundationsMeta {
  version: string;
  generatedAt: string;
  sources: Partial<
    Record<AppCode, { label?: string; figmaUrl?: string | null; tokenSource?: string }>
  >;
  notes?: string;
}

export interface FoundationsCatalog {
  meta: FoundationsMeta;
  sections: Record<FoundationSection, { groups: FoundationGroup[] }>;
}

export interface FoundationRowView {
  group: string;
  id: string;
  label: string;
  apps: Partial<Record<AppCode, FoundationAppValue>>;
  diff: boolean;
  missing: AppCode[];
  cgOnly?: boolean;
}

export const FOUNDATION_SECTION_LABELS: Record<FoundationSection, string> = {
  colors: 'Colors',
  typography: 'Typography',
  spacing: 'Spacing & radius',
};

export const FOUNDATION_SECTIONS: FoundationSection[] = ['colors', 'typography', 'spacing'];
