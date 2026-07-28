import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { APP_CODES } from '../../models/catalog.model';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-gaps',
  imports: [AsyncPipe, FormsModule, RouterLink],
  templateUrl: './gaps.component.html',
  styleUrl: './gaps.component.css',
})
export class GapsComponent {
  readonly catalog = inject(CatalogService);
  readonly apps = APP_CODES;
  severityFilter = '';
  kindFilter = '';

  gaps$ = this.buildGaps$();

  refresh(): void {
    this.gaps$ = this.buildGaps$();
  }

  private buildGaps$() {
    return this.catalog.getAllGaps().pipe(
      map((gaps) =>
        gaps.filter((g) => {
          if (this.severityFilter && g.severity !== this.severityFilter) return false;
          if (this.kindFilter && g.kind !== this.kindFilter) return false;
          return true;
        })
      )
    );
  }
}
