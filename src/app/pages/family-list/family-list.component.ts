import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { APP_CODES, APP_LABELS, AppCode, CATEGORY_LABELS, ComponentCategory } from '../../models/catalog.model';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-family-list',
  imports: [AsyncPipe, FormsModule, RouterLink],
  templateUrl: './family-list.component.html',
  styleUrl: './family-list.component.css',
})
export class FamilyListComponent {
  readonly catalog = inject(CatalogService);
  readonly apps = APP_CODES;
  readonly appLabels = APP_LABELS;
  readonly categories = Object.entries(CATEGORY_LABELS);

  search = '';
  categoryFilter = '';
  /** When empty, any presence; otherwise family must exist in every checked app (AND). */
  presenceApps: Record<AppCode, boolean> = { cg: false, ds: false, es: false };
  gapFilter = '';
  designFilter = '';
  figmaFilter = '';

  families$ = this.buildFamilies$();

  refreshFilters(): void {
    this.families$ = this.buildFamilies$();
  }

  private buildFamilies$() {
    return this.catalog.getFamilies().pipe(
      map((families) => {
        const q = this.search.trim().toLowerCase();
        return families.filter((f) => {
          if (this.categoryFilter && f.category !== this.categoryFilter) return false;
          const requiredApps = APP_CODES.filter((app) => this.presenceApps[app]);
          if (requiredApps.length > 0 && !requiredApps.every((app) => this.catalog.hasImplementation(f, app))) {
            return false;
          }
          if (this.gapFilter === 'any' && !(f.gaps?.length)) return false;
          if (this.gapFilter === 'blocker' && !(f.gaps?.some((g) => g.severity === 'blocker'))) return false;
          if (this.designFilter === 'documented' && !this.catalog.hasDesignData(f)) return false;
          if (this.designFilter === 'missing' && this.catalog.hasDesignData(f)) return false;
          if (this.figmaFilter === 'has' && !this.catalog.hasFigmaDesign(f)) return false;
          if (this.figmaFilter === 'missing' && this.catalog.hasFigmaDesign(f)) return false;
          if (!q) return true;
          return f.label.toLowerCase().includes(q) || f.id.includes(q);
        });
      })
    );
  }

  hasImpl(family: { implementations: Record<string, unknown> }, app: string): boolean {
    return !!family.implementations[app];
  }

  categoryLabel(c: ComponentCategory): string {
    return CATEGORY_LABELS[c] ?? c;
  }

  designCoverageLabel(family: Parameters<CatalogService['hasDesignData']>[0]): string {
    const { documented, present } = this.catalog.designCoverage(family);
    if (!present) return '—';
    return `${documented}/${present}`;
  }
}
