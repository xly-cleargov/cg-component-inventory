import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { map, switchMap } from 'rxjs';
import { APP_LABELS, AppCode } from '../../models/catalog.model';
import { CatalogService } from '../../services/catalog.service';

@Component({
  selector: 'app-source-list',
  imports: [AsyncPipe],
  templateUrl: './source-list.component.html',
  styleUrl: './source-list.component.css',
})
export class SourceListComponent {
  private readonly route = inject(ActivatedRoute);
  readonly catalog = inject(CatalogService);
  readonly appLabels = APP_LABELS;

  inventory$ = this.route.paramMap.pipe(
    switchMap((params) => {
      const app = (params.get('app') ?? 'cg') as AppCode;
      return this.catalog.getRawInventory(app).pipe(map((inv) => ({ app, inv })));
    })
  );
}
