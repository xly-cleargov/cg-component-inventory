import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import {
  APP_CODES,
  AppCode,
  CatalogMeta,
  ComponentCatalog,
  ComponentDesign,
  ComponentFamily,
  DesignMeta,
  DesignValue,
  Gap,
  GapSeverity,
  Implementation,
  RawInventory,
} from '../models/catalog.model';

@Injectable({ providedIn: 'root' })
export class CatalogService {
  private readonly http = inject(HttpClient);
  private catalog$?: Observable<ComponentCatalog>;

  getCatalog(): Observable<ComponentCatalog> {
    if (!this.catalog$) {
      this.catalog$ = this.http
        .get<ComponentCatalog>('/data/catalog.json')
        .pipe(shareReplay(1));
    }
    return this.catalog$;
  }

  getFamilies(): Observable<ComponentFamily[]> {
    return this.getCatalog().pipe(map((c) => c.families));
  }

  getFamily(id: string): Observable<ComponentFamily | undefined> {
    return this.getFamilies().pipe(map((families) => families.find((f) => f.id === id)));
  }

  getAllGaps(): Observable<(Gap & { familyId: string; familyLabel: string })[]> {
    return this.getFamilies().pipe(
      map((families) =>
        families.flatMap((f) =>
          (f.gaps ?? []).map((g) => ({
            ...g,
            familyId: f.id,
            familyLabel: f.label,
          }))
        )
      )
    );
  }

  getRawInventory(app: AppCode): Observable<RawInventory> {
    return this.http.get<RawInventory>(`/data/sources/${app}.raw.json`);
  }

  hasImplementation(family: ComponentFamily, app: AppCode): boolean {
    return !!family.implementations[app];
  }

  hasAllApps(family: ComponentFamily): boolean {
    return APP_CODES.every((app) => this.hasImplementation(family, app));
  }

  presenceCount(family: ComponentFamily): number {
    return APP_CODES.filter((app) => this.hasImplementation(family, app)).length;
  }

  countGapsBySeverity(family: ComponentFamily): Record<GapSeverity, number> {
    const counts: Record<GapSeverity, number> = {
      low: 0,
      medium: 0,
      high: 0,
      blocker: 0,
    };
    for (const gap of family.gaps ?? []) {
      counts[gap.severity]++;
    }
    return counts;
  }

  propNamesForApps(family: ComponentFamily): Map<string, Set<AppCode>> {
    const map = new Map<string, Set<AppCode>>();
    for (const app of APP_CODES) {
      const impl = family.implementations[app];
      if (!impl?.api?.props) continue;
      for (const prop of impl.api.props) {
        if (!map.has(prop.name)) map.set(prop.name, new Set());
        map.get(prop.name)!.add(app);
      }
    }
    return map;
  }

  designGroups = ['colors', 'spacing', 'radius', 'typography', 'elevation'] as const;

  designTokensForApps(
    family: ComponentFamily,
  ): Map<string, { group: string; name: string; apps: Partial<Record<AppCode, DesignValue>> }> {
    const map = new Map<string, { group: string; name: string; apps: Partial<Record<AppCode, DesignValue>> }>();
    for (const app of APP_CODES) {
      const impl = family.implementations[app];
      if (!impl?.design) continue;
      for (const group of this.designGroups) {
        for (const token of impl.design[group] ?? []) {
          const key = `${group}:${token.name}`;
          if (!map.has(key)) {
            map.set(key, { group, name: token.name, apps: {} });
          }
          map.get(key)!.apps[app] = token;
        }
      }
    }
    return map;
  }

  hasDesignData(family: ComponentFamily): boolean {
    return APP_CODES.some((app) => {
      const impl = family.implementations[app];
      return !!impl && this.hasTangibleDesign(impl.design, impl.designMeta);
    });
  }

  /** Colors, typography, radius, elevation, token-backed spacing, or curated enrichment — not layout margins alone. */
  hasTangibleDesign(design?: ComponentDesign, designMeta?: DesignMeta): boolean {
    if (designMeta?.enrichedAt) return true;
    if (!design) return false;
    if ((design.colors?.length ?? 0) > 0) return true;
    if ((design.radius?.length ?? 0) > 0) return true;
    if ((design.typography?.length ?? 0) > 0) return true;
    if ((design.elevation?.length ?? 0) > 0) return true;
    return (design.spacing ?? []).some((t) => !!t.tokenRef);
  }

  hasDesignValues(design?: ComponentDesign, designMeta?: DesignMeta): boolean {
    return this.hasTangibleDesign(design, designMeta);
  }

  /** Figma file landing nodes — not component-specific design sections. */
  private static readonly FIGMA_FILE_ROOT_NODES = new Set([
    '5344-1363',
    '5344:1363',
    '4653-10511',
    '4653:10511',
    '1-2',
    '1:2',
  ]);

  /** True when the URL points at a mapped component/page node, not the design-system file root. */
  isComponentFigmaNodeUrl(url?: string): boolean {
    if (!url) return false;
    const match = url.match(/node-id=([^&]+)/i);
    if (!match) return false;
    const nodeId = decodeURIComponent(match[1]);
    return !CatalogService.FIGMA_FILE_ROOT_NODES.has(nodeId);
  }

  /** Component-specific Figma node URL only — no design-system file fallback. */
  resolveFigmaUrl(_app: AppCode, impl: Implementation, _meta?: CatalogMeta): string | undefined {
    const url = impl.designMeta?.figmaUrl;
    return url && this.isComponentFigmaNodeUrl(url) ? url : undefined;
  }

  isComponentFigmaNode(impl: Implementation): boolean {
    return this.isComponentFigmaNodeUrl(impl.designMeta?.figmaUrl);
  }

  designCoverage(family: ComponentFamily): { documented: number; present: number } {
    const present = APP_CODES.filter((app) => family.implementations[app]).length;
    const documented = APP_CODES.filter((app) => {
      const impl = family.implementations[app];
      return !!impl && this.hasTangibleDesign(impl.design, impl.designMeta);
    }).length;
    return { documented, present };
  }

  isHexColor(value: string): boolean {
    return /^#([0-9a-f]{3,8})$/i.test(value);
  }

  exportCatalogJson(): Observable<string> {
    return this.getCatalog().pipe(map((c) => JSON.stringify(c, null, 2)));
  }

  exportMarkdownSummary(): Observable<string> {
    return this.getCatalog().pipe(
      map((catalog) => {
        const lines: string[] = [
          '# ClearGov Component Inventory',
          '',
          `Generated: ${catalog.meta.generatedAt}`,
          '',
          '## Families',
          '',
        ];
        for (const family of catalog.families) {
          lines.push(`### ${family.label} (\`${family.id}\`)`);
          lines.push('');
          for (const app of APP_CODES) {
            const impl = family.implementations[app];
            lines.push(`- **${app.toUpperCase()}**: ${impl ? impl.selectorOrExport ?? impl.id : '_missing_'}`);
          }
          if (family.gaps?.length) {
            lines.push('');
            lines.push('**Gaps:**');
            for (const gap of family.gaps) {
              lines.push(`- [${gap.severity}] ${gap.summary}`);
            }
          }
          lines.push('');
        }
        return lines.join('\n');
      })
    );
  }
}
