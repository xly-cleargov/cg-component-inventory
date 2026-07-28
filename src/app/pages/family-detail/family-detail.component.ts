import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { combineLatest, map, switchMap } from 'rxjs';
import { APP_CODES, APP_LABELS, AppCode, CatalogMeta, Implementation } from '../../models/catalog.model';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-family-detail',
  imports: [AsyncPipe, RouterLink],
  templateUrl: './family-detail.component.html',
  styleUrl: './family-detail.component.css',
})
export class FamilyDetailComponent {
  private readonly route = inject(ActivatedRoute);
  readonly catalog = inject(CatalogService);
  readonly apps = APP_CODES;
  readonly appLabels = APP_LABELS;
  activeTab: 'api' | 'design' | 'gaps' = 'api';

  family$ = this.route.paramMap.pipe(
    switchMap((params) => this.catalog.getFamily(params.get('id') ?? ''))
  );

  familyView$ = combineLatest([this.family$, this.catalog.getCatalog()]).pipe(
    map(([family, catalog]) => (family ? { family, meta: catalog.meta } : null)),
  );

  propMatrix$ = this.family$.pipe(
    map((family) => {
      if (!family) return [];
      const names = this.catalog.propNamesForApps(family);
      return [...names.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, appsWith]) => ({
          name,
          apps: Object.fromEntries(APP_CODES.map((app) => [app, appsWith.has(app)])) as Record<string, boolean>,
        }));
    })
  );

  designMatrix$ = this.family$.pipe(
    map((family) => {
      if (!family) return [];
      const tokens = this.catalog.designTokensForApps(family);
      return [...tokens.values()]
        .sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
        .map((row) => {
          const values = APP_CODES.filter((app) => row.apps[app]?.value).map((app) => row.apps[app]!.value);
          const allSame = values.length > 1 && new Set(values).size === 1;
          const anyPresent = values.length > 0;
          return {
            group: row.group,
            name: row.name,
            apps: Object.fromEntries(
              APP_CODES.map((app) => [app, row.apps[app] ?? null])
            ) as Record<AppCode, { value: string; tokenRef?: string | null } | null>,
            diff: anyPresent && !allSame,
          };
        });
    })
  );

  exportJson(): void {
    this.catalog.exportCatalogJson().subscribe((json) => this.download('catalog.json', json, 'application/json'));
  }

  exportMarkdown(): void {
    this.catalog.exportMarkdownSummary().subscribe((md) => this.download('inventory-summary.md', md, 'text/markdown'));
  }

  designSourceLabel(source?: string): string {
    switch (source) {
      case 'figma': return 'Figma';
      case 'code': return 'Code';
      case 'mixed': return 'Mixed';
      default: return 'Unknown';
    }
  }

  figmaUrl(app: AppCode, impl: Implementation, meta: CatalogMeta): string | undefined {
    return this.catalog.resolveFigmaUrl(app, impl, meta);
  }

  private download(filename: string, content: string, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
