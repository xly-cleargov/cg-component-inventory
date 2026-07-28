import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map, shareReplay } from 'rxjs';
import { APP_CODES, AppCode } from '../models/catalog.model';
import {
  FoundationRowView,
  FoundationSection,
  FoundationsCatalog,
  FoundationToken,
} from '../models/foundations.model';

@Injectable({ providedIn: 'root' })
export class FoundationsService {
  private readonly http = inject(HttpClient);
  private foundations$?: Observable<FoundationsCatalog>;

  getFoundations(): Observable<FoundationsCatalog> {
    if (!this.foundations$) {
      this.foundations$ = this.http
        .get<FoundationsCatalog>('/data/foundations.json')
        .pipe(shareReplay(1));
    }
    return this.foundations$;
  }

  rowsForSection(section: FoundationSection, diffsOnly = false, groupFilter = ''): Observable<FoundationRowView[]> {
    return this.getFoundations().pipe(
      map((data) => this.filterRows(data, section, diffsOnly, groupFilter))
    );
  }

  mainRowsForSection(section: FoundationSection, diffsOnly = false, groupFilter = ''): Observable<FoundationRowView[]> {
    return this.rowsForSection(section, diffsOnly, groupFilter).pipe(
      map((rows) => rows.filter((r) => !r.cgOnly))
    );
  }

  cgOnlyRowsForSection(section: FoundationSection): Observable<FoundationRowView[]> {
    const typoOrder = ['Headers', 'Subheaders', 'Body', 'Captions'];
    return this.getFoundations().pipe(
      map((data) => {
        const rows = this.filterRows(data, section, false, '').filter((r) => r.cgOnly);
        if (section !== 'typography') return rows;
        return rows.sort((a, b) => {
          const ai = typoOrder.indexOf(a.group);
          const bi = typoOrder.indexOf(b.group);
          if (ai !== bi) return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
          return a.label.localeCompare(b.label);
        });
      })
    );
  }

  private filterRows(
    data: FoundationsCatalog,
    section: FoundationSection,
    diffsOnly: boolean,
    groupFilter: string
  ): FoundationRowView[] {
    const groups = data.sections[section]?.groups ?? [];
    const rows = groups.flatMap((g) => g.tokens.map((token) => this.toRowView(g.label, token)));
    return rows.filter((r) => {
      if (groupFilter && r.group !== groupFilter) return false;
      if (r.cgOnly) return true;
      return diffsOnly ? r.diff : true;
    });
  }

  groupsForSection(section: FoundationSection): Observable<string[]> {
    return this.getFoundations().pipe(
      map((data) => (data.sections[section]?.groups ?? []).map((g) => g.label))
    );
  }

  private toRowView(groupLabel: string, token: FoundationToken): FoundationRowView {
    const values = APP_CODES.map((app) => token.apps[app]?.value).filter(Boolean) as string[];
    const normalized = values.map((v) => this.normalizeValue(v));
    const allSame = normalized.length > 1 && new Set(normalized).size === 1;
    const anyPresent = normalized.length > 0;
    const missing = APP_CODES.filter((app) => !token.apps[app]?.value);

    return {
      group: groupLabel,
      id: token.id,
      label: token.label,
      apps: token.apps,
      diff: token.cgOnly ? false : anyPresent && !allSame,
      missing,
      cgOnly: token.cgOnly ?? false,
    };
  }

  normalizeValue(value: string): string {
    const v = value.trim();
    if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase();
    if (/^\d+px$/i.test(v)) return v.toLowerCase();
    return v.toLowerCase();
  }

  isColorValue(value: string | null | undefined): boolean {
    return !!value && /^#[0-9a-f]{3,8}$/i.test(value.trim());
  }

  isPxValue(value: string | null | undefined): boolean {
    return !!value && /^\d+(\.\d+)?px$/i.test(value.trim());
  }

  pxNumber(value: string | null | undefined): number {
    if (!value) return 0;
    const m = value.match(/^(\d+(?:\.\d+)?)px$/i);
    return m ? parseFloat(m[1]) : 0;
  }

  compareApps(row: FoundationRowView): Record<AppCode, 'same' | 'diff' | 'missing'> {
    const result = {} as Record<AppCode, 'same' | 'diff' | 'missing'>;
    const baseline = APP_CODES.map((app) => row.apps[app]?.value).find(Boolean);
    const baseNorm = baseline ? this.normalizeValue(baseline) : null;

    for (const app of APP_CODES) {
      const val = row.apps[app]?.value;
      if (!val) {
        result[app] = 'missing';
      } else if (!baseNorm || this.normalizeValue(val) === baseNorm) {
        result[app] = 'same';
      } else {
        result[app] = 'diff';
      }
    }
    return result;
  }
}
