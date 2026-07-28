import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/family-list/family-list.component').then(m => m.FamilyListComponent) },
  { path: 'family/:id', loadComponent: () => import('./pages/family-detail/family-detail.component').then(m => m.FamilyDetailComponent) },
  { path: 'gaps', loadComponent: () => import('./pages/gaps/gaps.component').then(m => m.GapsComponent) },
  { path: 'foundations', redirectTo: 'foundations/colors', pathMatch: 'full' },
  { path: 'foundations/:section', loadComponent: () => import('./pages/foundations-compare/foundations-compare.component').then(m => m.FoundationsCompareComponent) },
  { path: 'sources/:app', loadComponent: () => import('./pages/source-list/source-list.component').then(m => m.SourceListComponent) },
  { path: '**', redirectTo: '' },
];
