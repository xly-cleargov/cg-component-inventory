import { AsyncPipe } from '@angular/common';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import { BehaviorSubject, combineLatest, map, of, switchMap } from 'rxjs';
import { APP_CODES, APP_LABELS } from '../../models/catalog.model';
import { FOUNDATION_SECTION_LABELS, FOUNDATION_SECTIONS, FoundationSection } from '../../models/foundations.model';
import { FoundationsService } from '../../services/foundations.service';

@Component({
  selector: 'app-foundations-compare',
  imports: [AsyncPipe, RouterLink, RouterLinkActive],
  templateUrl: './foundations-compare.component.html',
  styleUrl: './foundations-compare.component.css',
})
export class FoundationsCompareComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly diffsOnly$ = new BehaviorSubject(false);
  private readonly groupFilter$ = new BehaviorSubject('');
  readonly foundations = inject(FoundationsService);
  readonly apps = APP_CODES;
  readonly appLabels = APP_LABELS;
  readonly sectionLabels = FOUNDATION_SECTION_LABELS;
  readonly sections = FOUNDATION_SECTIONS;

  meta$ = this.foundations.getFoundations().pipe(map((d) => d.meta));

  activeSection$ = this.route.paramMap.pipe(
    map((params) => {
      const s = params.get('section') as FoundationSection | null;
      return s && s in FOUNDATION_SECTION_LABELS ? s : 'colors';
    })
  );

  rows$ = combineLatest([this.activeSection$, this.diffsOnly$, this.groupFilter$]).pipe(
    switchMap(([section, diffsOnly, groupFilter]) =>
      this.foundations.mainRowsForSection(section, diffsOnly, section === 'colors' ? groupFilter : '')
    )
  );

  cgOnlyRows$ = this.activeSection$.pipe(
    switchMap((section) =>
      section === 'colors' || section === 'typography'
        ? this.foundations.cgOnlyRowsForSection(section)
        : of([])
    )
  );

  cgOnlySectionTitle(section: FoundationSection): string {
    return section === 'typography' ? 'CG typography styles' : 'CG-only palette steps';
  }

  cgOnlySectionIntro(section: FoundationSection): string {
    if (section === 'typography') {
      return 'ClearGov 1.0 composite text styles (headers, subheaders, body, captions). DS/ES show closest size match when available.';
    }
    return 'ClearGov 1.0 defines these ramp steps (e.g. blue-07, blue-15, blue-75) with no mapped equivalent in Disclosure Studio or Engagement Studio.';
  }

  colorGroups$ = this.foundations.groupsForSection('colors');

  setDiffsOnly(checked: boolean): void {
    this.diffsOnly$.next(checked);
  }

  setGroupFilter(value: string): void {
    this.groupFilter$.next(value);
  }

  barWidth(value: string | null | undefined, maxPx = 64): number {
    const px = this.foundations.pxNumber(value);
    return Math.min(100, Math.max(4, (px / maxPx) * 100));
  }
}
