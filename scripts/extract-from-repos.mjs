#!/usr/bin/env node
/**
 * Extract component inventories from local repo clones (read-only).
 * Figma files are referenced in origin.figmaUrl — never modified.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { extractDesignFromStyles, extractDesignFromTailwind, hasDesignData, hasTangibleDesign } from './design-extract.mjs';
import { familyIdFromCg, resolveFamilyId } from './family-aliases.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataDir = join(root, 'data', 'sources');
const gravityComponentsPath = join(root, 'data', 'ds-gravity-components.json');

const SOURCES = {
  cg: {
    repo: join('c:', 'Work', 'cleargov-shared'),
    github: 'https://github.com/ClearGovInc/cleargov-shared',
    figma: 'https://www.figma.com/design/JdGC6oj27gAt2VGDauVH2G/ClearGov-Design-System?node-id=5344-1363&p=f&t=kdMedCVWjFszF8po-0',
    scanRoot: join('c:', 'Work', 'cleargov-shared', 'libs', 'shared-ui'),
  },
  ds: {
    repo: join(root, 'repos', 'gravity-reporting-next-ui'),
    github: 'https://github.com/igmtechnology/gravity-reporting-next-ui',
    figma: 'https://www.figma.com/design/cErW0lkFuaZarQkuRr6bS8/Gravity-design-foundations?node-id=4653-10511',
    scanRoot: join(root, 'repos', 'gravity-reporting-next-ui', 'src'),
  },
  es: {
    repo: join(root, 'repos', 'community-modules'),
    github: 'https://github.com/coUrbanize/community-modules',
    figma: 'https://www.figma.com/design/lyDU3cSfPqsdONVBLi6f1T/Community-Design-System?node-id=1-2',
    scanRoot: join(root, 'repos', 'community-modules', 'src', 'components'),
  },
};

const SKIP_CG_FOLDERS = new Set([
  'directives', 'form-components', 'guards', 'helpers', 'services', 'src', 'styles', 'types', 'utils',
]);

const CATEGORY_MAP = {
  button: 'action', 'button-dropdown': 'action', 'button-group': 'action', 'actions-button-group': 'action',
  link: 'action', tag: 'action',
  checkbox: 'form', radio: 'form', switch: 'form', 'color-picker': 'form', 'color-select': 'form',
  'combo-box': 'form', 'search-select': 'form', 'type-ahead': 'form', 'year-select': 'form',
  'tree-select': 'form', 'tree-select-dropdown': 'form', 'tree-select-panel': 'form', 'csv-file-upload': 'form',
  modal: 'overlay', drawer: 'overlay', tooltip: 'overlay', 'slide-up': 'overlay',
  toast: 'feedback', notification: 'feedback', banner: 'feedback', loader: 'feedback',
  tabs: 'navigation', navbar: 'navigation', breadcrumbs: 'navigation', 'vertical-menu': 'navigation', header: 'navigation',
  grid: 'data', table: 'data', pagination: 'data', 'grouped-bar': 'data', 'timeline-chart': 'data',
  card: 'layout', panel: 'layout', layout: 'layout', 'content-box': 'layout', stepper: 'layout',
  avatar: 'media', carousel: 'media', 'map-box': 'media', badge: 'feedback', accordion: 'layout',
  timeline: 'data', 'table-header-toolbar': 'data', 'tree-settings': 'form',
};

const DX_KEEP = new Set(['dx-data-grid', 'dx-pivot-grid', 'dx-tree-list', 'dx-tree-view', 'dx-file-manager', 'dx-spreadsheet']);

function gitRef(repoPath) {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: repoPath, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function walkFiles(dir, ext, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (!entry.includes('node_modules')) walkFiles(p, ext, out);
    } else if (entry.endsWith(ext)) {
      out.push(p);
    }
  }
  return out;
}

function parseAngularInputsOutputs(content) {
  const props = [];
  const events = [];
  for (const m of content.matchAll(/@Input\(\)\s*(\w+)\??(?:\s*=\s*([^;\n]+))?/g)) {
    props.push({ name: m[1], type: 'unknown', default: m[2]?.trim() ?? null, required: false, values: [], description: '' });
  }
  for (const m of content.matchAll(/@Output\(\)\s*(\w+)/g)) {
    events.push({ name: m[1], payloadType: 'unknown', description: '' });
  }
  return { props, events };
}

function parseSelector(content) {
  const m = content.match(/selector:\s*['"]([^'"]+)['"]/);
  return m?.[1] ?? null;
}

function emptyDesign() {
  return { colors: [], spacing: [], radius: [], typography: [], elevation: [], states: [] };
}

function designMetaFromCode(notes, figmaUrl) {
  return {
    source: 'code',
    notes,
    ...(figmaUrl ? { figmaUrl } : {}),
  };
}

function extractCg() {
  const cfg = SOURCES.cg;
  const components = [];

  for (const folder of readdirSync(cfg.scanRoot)) {
    if (SKIP_CG_FOLDERS.has(folder)) continue;
    const folderPath = join(cfg.scanRoot, folder);
    if (!statSync(folderPath).isDirectory()) continue;

    const tsFiles = walkFiles(folderPath, '.component.ts');
    const main = tsFiles.find((f) => basename(f).startsWith('cg-')) ?? tsFiles[0];
    if (!main) continue;

    const content = readFileSync(main, 'utf8');
    const selector = parseSelector(content) ?? `cg-${folder}`;
    const { props, events } = parseAngularInputsOutputs(content);
    const autoDesign = extractDesignFromStyles(main);

    components.push({
      id: selector,
      displayName: folder.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
      category: CATEGORY_MAP[folder] ?? 'other',
      framework: 'angular',
      packageOrPath: `@cleargov/shared-ui/${folder}`,
      selectorOrExport: selector,
      usage: { instanceCount: null, fileCount: null, samplePaths: [main.replace(/\\/g, '/')] },
      api: { props, events, slots: [], methods: [], services: [] },
      design: autoDesign,
      ...(hasDesignData(autoDesign)
        ? { designMeta: designMetaFromCode('Auto-extracted from component stylesheet') }
        : {}),
      a11y: { role: null, labelProps: [], notes: '' },
      migrateHint: folder === 'grid' ? 'keep' : 'unknown',
      confidence: props.length ? 'medium' : 'low',
      notes: '',
    });
  }

  // Services
  const servicesPath = join(cfg.scanRoot, 'services');
  if (existsSync(servicesPath)) {
    for (const f of walkFiles(servicesPath, '.service.ts')) {
      const name = basename(f, '.service.ts');
      components.push({
        id: `cg-${name}-service`,
        displayName: `${name} Service`,
        category: 'overlay',
        framework: 'angular',
        packageOrPath: `@cleargov/shared-ui/services/${name}`,
        selectorOrExport: name,
        usage: { instanceCount: null, fileCount: null, samplePaths: [f.replace(/\\/g, '/')] },
        api: { props: [], events: [], slots: [], methods: [], services: [{ name, methods: [], description: '' }] },
        design: { colors: [], spacing: [], radius: [], typography: [], elevation: [], states: [] },
        a11y: { role: null, labelProps: [], notes: '' },
        migrateHint: 'adapt',
        confidence: 'medium',
        notes: 'Angular injectable service',
      });
    }
  }

  return {
    source: 'cg',
    extractedAt: new Date().toISOString(),
    origin: {
      repoOrPackage: cfg.github,
      ref: gitRef(cfg.repo),
      figmaUrl: cfg.figma,
      notes: 'Extracted from libs/shared-ui. Figma read-only reference.',
    },
    components: components.sort((a, b) => a.id.localeCompare(b.id)),
    familiesGuess: Object.fromEntries(components.map((c) => [c.id, c.id.replace(/^cg-/, '').replace(/-service$/, '')])),
  };
}

function relSamplePath(absPath) {
  return absPath.replace(/\\/g, '/').split('/src/')[1] ?? absPath.replace(/\\/g, '/');
}

function countSelectorUsage(scanRoot, selector) {
  const tagPattern = new RegExp(`<${selector}(?:[\\s>/])`, 'g');
  const files = new Set();
  let instanceCount = 0;
  for (const ext of ['.html', '.ts']) {
    for (const file of walkFiles(scanRoot, ext).filter((f) => !f.includes('.spec.'))) {
      const content = readFileSync(file, 'utf8');
      const matches = [...content.matchAll(tagPattern)];
      if (matches.length > 0) {
        instanceCount += matches.length;
        files.add(file);
      }
    }
  }
  return {
    instanceCount,
    fileCount: files.size,
    samplePaths: [...files].slice(0, 3).map(relSamplePath),
  };
}

/** DevExtreme widgets actually used in DS templates (and dx-notify via devextreme/ui/notify). */
function extractDxWidgetUsage(scanRoot) {
  const usageByWidget = new Map();

  const noteUsage = (widget, file, count = 1) => {
    if (!usageByWidget.has(widget)) {
      usageByWidget.set(widget, { instanceCount: 0, files: new Set(), samplePaths: [] });
    }
    const entry = usageByWidget.get(widget);
    entry.instanceCount += count;
    if (!entry.files.has(file)) {
      entry.files.add(file);
      if (entry.samplePaths.length < 3) entry.samplePaths.push(relSamplePath(file));
    }
  };

  for (const file of walkFiles(scanRoot, '.html').filter((f) => !f.includes('.spec.'))) {
    const content = readFileSync(file, 'utf8');
    for (const m of content.matchAll(/<(dx-[a-z-]+)/g)) {
      noteUsage(m[1], file);
    }
  }

  for (const file of walkFiles(scanRoot, '.ts').filter((f) => !f.includes('.spec.'))) {
    const content = readFileSync(file, 'utf8');
    if (!/from\s+['"]devextreme\/ui\/notify['"]/.test(content)) continue;
    const notifyCalls = [...content.matchAll(/\bnotify\s*\(/g)].length;
    if (notifyCalls > 0) noteUsage('dx-notify', file, notifyCalls);
  }

  return usageByWidget;
}

function extractOpeningTags(content, widget) {
  const tags = [];
  const needle = `<${widget}`;
  let pos = 0;
  while (pos < content.length) {
    const start = content.indexOf(needle, pos);
    if (start === -1) break;
    let i = start + needle.length;
    let inQuote = null;
    while (i < content.length) {
      const ch = content[i];
      if (inQuote) {
        if (ch === inQuote && content[i - 1] !== '\\') inQuote = null;
      } else if (ch === '"' || ch === "'") {
        inQuote = ch;
      } else if (ch === '>') {
        tags.push(content.slice(start, i + 1));
        break;
      }
      i++;
    }
    pos = i + 1;
  }
  return tags;
}

const SKIP_TEMPLATE_ATTRS = new Set([
  'class', 'id', 'style', 'type', 'role', 'tabindex', 'title', 'href', 'src', 'alt', 'for', 'name', 'value',
]);

/** Props/events observed on dx-* tags in DS HTML templates. */
function extractDxTemplateBindings(scanRoot, widget) {
  const props = new Set();
  const events = new Set();

  for (const file of walkFiles(scanRoot, '.html').filter((f) => !f.includes('.spec.'))) {
    const content = readFileSync(file, 'utf8');
    for (const tag of extractOpeningTags(content, widget)) {
      for (const m of tag.matchAll(/\[(?!#)([A-Za-z][\w]*)\]/g)) props.add(m[1]);
      for (const m of tag.matchAll(/\(([a-zA-Z][\w]*)\)/g)) {
        if (m[1].startsWith('on') && m[1] !== 'on') events.add(m[1]);
      }
      for (const m of tag.matchAll(/(?:^|\s)([a-zA-Z][\w-]*)=/g)) {
        const name = m[1];
        if (!name.startsWith('ng') && !name.startsWith('*') && !SKIP_TEMPLATE_ATTRS.has(name)) props.add(name);
      }
    }
  }

  return { props: [...props].sort(), events: [...events].sort() };
}

const devextremeApiCache = new Map();

function devextremeAngularDtsPath(repoPath, widget) {
  const folder = widget.replace(/^dx-/, '');
  return join(repoPath, 'node_modules', 'devextreme-angular', 'ui', folder, 'index.d.ts');
}

function parseDevextremeAngularDts(dtsPath) {
  if (!existsSync(dtsPath)) return null;
  const content = readFileSync(dtsPath, 'utf8');
  const props = [];
  const events = [];
  const seenProps = new Set();
  const seenEvents = new Set();

  for (const m of content.matchAll(/^\s+get (\w+)\(\):\s*([^;]+);/gm)) {
    const name = m[1];
    if (name === 'instance' || seenProps.has(name)) continue;
    seenProps.add(name);
    props.push({
      name,
      type: m[2].trim(),
      default: null,
      required: false,
      values: [],
      description: '',
    });
  }

  for (const m of content.matchAll(/^\s+(on[A-Z]\w*): EventEmitter<([^>]+)>/gm)) {
    const name = m[1];
    if (seenEvents.has(name)) continue;
    seenEvents.add(name);
    events.push({ name, payloadType: m[2].trim(), description: '' });
  }

  return { props, events };
}

function buildDxNotifyApi() {
  return {
    props: [
      { name: 'message', type: 'string', default: null, required: true, values: [], description: 'Notification text' },
      { name: 'type', type: 'string', default: 'info', required: false, values: ['info', 'success', 'warning', 'error'], description: '' },
      { name: 'displayTime', type: 'number', default: null, required: false, values: [], description: 'Display duration in ms' },
    ],
    events: [],
    slots: [],
    methods: [{ name: 'notify', signature: 'notify(message, type?, displayTime?)', description: 'DevExtreme ui/notify' }],
    services: [],
  };
}

function buildDevextremeWidgetApi(repoPath, scanRoot, widget) {
  const cacheKey = `${repoPath}:${widget}`;
  if (devextremeApiCache.has(cacheKey)) return devextremeApiCache.get(cacheKey);

  if (widget === 'dx-notify') {
    const api = buildDxNotifyApi();
    devextremeApiCache.set(cacheKey, api);
    return api;
  }

  const observed = extractDxTemplateBindings(scanRoot, widget);
  const observedProps = new Set(observed.props);
  const observedEvents = new Set(observed.events);

  const parsed = parseDevextremeAngularDts(devextremeAngularDtsPath(repoPath, widget));
  let api;

  if (parsed?.props.length) {
    api = {
      props: parsed.props.map((p) => ({
        ...p,
        description: observedProps.has(p.name) ? 'Used in DS templates' : p.description,
      })),
      events: parsed.events.map((e) => ({
        ...e,
        description: observedEvents.has(e.name) ? 'Used in DS templates' : e.description,
      })),
      slots: [],
      methods: [],
      services: [],
    };
  } else {
    api = {
      props: observed.props.map((name) => ({
        name,
        type: 'unknown',
        default: null,
        required: false,
        values: [],
        description: 'Observed in DS templates (devextreme-angular types unavailable)',
      })),
      events: observed.events.map((name) => ({
        name,
        payloadType: 'unknown',
        description: 'Observed in DS templates',
      })),
      slots: [],
      methods: [],
      services: [],
    };
  }

  devextremeApiCache.set(cacheKey, api);
  return api;
}

function selectorToLabel(selector) {
  return selector
    .replace(/^app-|^mdds-|^ck-/, '')
    .split('-')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

function guessDsCategory(selector, relPath) {
  const s = selector.toLowerCase();
  const p = relPath.toLowerCase();
  if (/modal|dialog|popup|popup-host/.test(s)) return 'overlay';
  if (/nav|rail|breadcrumb|sidebar/.test(s) || p.includes('navigation')) return 'navigation';
  if (/load|warning|notice|toast|notification|support/.test(s)) return 'feedback';
  if (/grid|table|pivot|tree|history|dataset|hypercube/.test(s) || p.includes('/grid/')) return 'data';
  if (/editor|spreadsheet|picker|toolbar|autocomplete|select|input|upload|file/.test(s)) return 'form';
  if (/workflow|stepper|wizard/.test(s) || p.includes('/workflow/')) return 'layout';
  if (/chart|graphics/.test(s)) return 'media';
  if (/settings|profile|security|user|group|permission/.test(s)) return 'other';
  return 'other';
}

function classifyDsComponent(selector, relPath) {
  const p = relPath.replace(/\\/g, '/').toLowerCase();
  if (/edit-block-|preview-block-|edit-field-/.test(selector)) {
    return { confidence: 'low', notes: 'Report section block (domain-specific editor/preview pair)' };
  }
  if (p.includes('/common/components/') && !p.includes('/workflow/')) {
    return { confidence: 'high', notes: 'Shared app shell / common UI component' };
  }
  if (p.includes('/workflow/') || /^app-add-/.test(selector)) {
    return { confidence: 'low', notes: 'Workflow builder domain sub-dialog (not a reusable UI primitive)' };
  }
  if (['mdds-search-input', 'mdds-tree', 'mdds-grid', 'mdds-caption', 'mdds-autocomplete', 'select-input', 'loading', 'warning', 'ck-text-editor', 'spreadsheet', 'file'].includes(selector)) {
    return { confidence: 'high', notes: 'Reusable DS UI primitive' };
  }
  if (p.includes('/settings/') || /^(app-settings|app-profile|app-overview|app-users|app-groups)$/.test(selector)) {
    return { confidence: 'low', notes: 'Settings / admin page shell' };
  }
  if (/^(report|reports|section|preview|templates|app-create-report)$/.test(selector)) {
    return { confidence: 'low', notes: 'Reporting feature page shell' };
  }
  if (p.includes('/mdds/components/')) {
    return { confidence: 'medium', notes: 'MDDS domain component' };
  }
  if (p.includes('/reporting/components/')) {
    return { confidence: 'medium', notes: 'Reporting domain component' };
  }
  return { confidence: 'medium', notes: '' };
}

const DS_CUSTOM_TO_FAMILY = {
  loading: 'loader',
  'select-input': 'dropdown',
  'app-confirm-dialog': 'confirm-modal',
  'app-confirm-dialog-container': 'confirm-modal',
  'app-popup-host': 'modal',
  'app-generate-pdf-popup': 'modal',
  'app-edit-permissions-popup': 'modal',
  'app-create-user-popup': 'modal',
  'app-create-group-popup': 'modal',
  warning: 'banner',
  'report-type': 'tag',
  navbar: 'navbar',
  'navigation-rail': 'vertical-menu',
  'app-tenant-switcher': 'dropdown',
  'app-file-vault': 'file-manager',
  'ck-text-editor': 'rich-text-editor',
  'html-editor': 'rich-text-editor',
  spreadsheet: 'spreadsheet',
  'mdds-search-input': 'input',
  'mdds-autocomplete': 'type-ahead',
  'mdds-tree': 'tree',
  'mdds-grid': 'data-grid',
  'mdds-caption': 'typography',
  file: 'drop-uploader',
  'app-upload-dialog': 'modal',
  'app-border-picker': 'color-picker',
  'app-theme-color-picker': 'color-picker',
  'app-format-picker': 'dropdown',
  'app-formula-autocomplete': 'type-ahead',
  'app-table-toolbar': 'table-header-toolbar',
  'app-table-edit': 'table',
  'graphics-toolbar': 'toolbar',
  'chart-import-wizard': 'stepper',
  support: 'feedback',
  'mdfm-variable-notice': 'banner',
  'app-access-denied': 'empty-state',
  'app-page-not-found': 'empty-state',
  'app-maintenance': 'empty-state',
};

function shouldKeepDsCustomComponent(selector, autoDesign) {
  if (DS_CUSTOM_TO_FAMILY[selector]) return true;
  return hasTangibleDesign(autoDesign);
}

function extractDsCustomComponents(cfg) {
  const componentFiles = walkFiles(cfg.scanRoot, '.component.ts').filter((f) => !f.includes('.spec.'));
  const components = [];

  for (const file of componentFiles) {
    const content = readFileSync(file, 'utf8');
    const selector = parseSelector(content);
    if (!selector || selector === 'app-root') continue;

    const appRel = file.replace(/\\/g, '/').split('/src/')[1] ?? file.replace(/\\/g, '/');

    const { props, events } = parseAngularInputsOutputs(content);
    const autoDesign = extractDesignFromStyles(file);
    if (!shouldKeepDsCustomComponent(selector, autoDesign)) continue;

    const usage = countSelectorUsage(cfg.scanRoot, selector);
    const { confidence, notes } = classifyDsComponent(selector, appRel);
    const classMatch = content.match(/export class (\w+)/);
    const displayName = classMatch?.[1]?.replace(/Component$/, '') ?? selectorToLabel(selector);
    const tangible = hasTangibleDesign(autoDesign);

    components.push({
      id: `ds-${selector}`,
      displayName,
      category: guessDsCategory(selector, appRel),
      framework: 'angular',
      packageOrPath: `src/${appRel}`,
      selectorOrExport: selector,
      usage,
      api: { props, events, slots: [], methods: [], services: [] },
      design: tangible ? autoDesign : emptyDesign(),
      ...(tangible ? { designMeta: designMetaFromCode('Auto-extracted from component stylesheet') } : {}),
      a11y: { role: null, labelProps: [], notes: '' },
      migrateHint: 'adapt',
      confidence,
      notes,
      _familyId: DS_CUSTOM_TO_FAMILY[selector],
    });
  }

  return components;
}

function loadGravityDesignSystemComponents() {
  if (!existsSync(gravityComponentsPath)) return [];
  const manifest = JSON.parse(readFileSync(gravityComponentsPath, 'utf8'));
  return (manifest.components ?? []).map((entry) => ({
    id: entry.id,
    displayName: entry.displayName,
    category: entry.category ?? 'other',
    framework: 'design-system',
    packageOrPath: entry.packageOrPath ?? 'Gravity design foundations',
    selectorOrExport: entry.selectorOrExport ?? entry.displayName,
    usage: { instanceCount: null, fileCount: null, samplePaths: entry.figmaUrl ? [entry.figmaUrl] : [] },
    api: entry.api ?? { props: [], events: [], slots: [], methods: [], services: [] },
    design: emptyDesign(),
    ...(entry.figmaUrl
      ? {
          designMeta: {
            source: 'figma',
            library: entry.packageOrPath ?? 'Gravity design foundations',
            figmaUrl: entry.figmaUrl,
            notes: entry.notes ?? '',
          },
        }
      : {}),
    a11y: { role: null, labelProps: [], notes: '' },
    migrateHint: entry.migrateHint ?? 'swap',
    confidence: entry.confidence ?? 'high',
    notes: entry.notes ?? '',
    _familyId: entry.familyId,
    _figmaUrl: entry.figmaUrl,
  }));
}

function extractDs() {
  const cfg = SOURCES.ds;
  const dxUsage = extractDxWidgetUsage(cfg.scanRoot);

  const dxComponents = [...dxUsage.entries()]
    .filter(([, usage]) => usage.instanceCount > 0)
    .sort((a, b) => b[1].instanceCount - a[1].instanceCount)
    .map(([widget, usage]) => {
      const api = buildDevextremeWidgetApi(cfg.repo, cfg.scanRoot, widget);
      const observed = extractDxTemplateBindings(cfg.scanRoot, widget);
      const notes = observed.props.length
        ? `DS template bindings: ${[...observed.props, ...observed.events.map((e) => `(${e})`)].join(', ')}`
        : '';
      return {
      id: widget,
      displayName: widget.replace(/^dx-/, '').split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
      category: widget.includes('grid') || widget.includes('pivot') || widget.includes('tree') ? 'data' : widget.includes('button') ? 'action' : widget.includes('popup') || widget.includes('drawer') ? 'overlay' : 'form',
      framework: 'devextreme',
      packageOrPath: `devextreme-angular/ui/${widget.replace('dx-', '')}`,
      selectorOrExport: widget,
      usage: { instanceCount: usage.instanceCount, fileCount: usage.files.size, samplePaths: usage.samplePaths },
      api,
      design: { colors: [], spacing: [], radius: [], typography: [], elevation: [], states: [] },
      a11y: { role: null, labelProps: [], notes: '' },
      migrateHint: DX_KEEP.has(widget) ? 'keep' : 'swap',
      confidence: 'high',
      notes,
    };
    });

  const gravityComponents = loadGravityDesignSystemComponents();
  const customComponents = extractDsCustomComponents(cfg);

  const byId = new Map();
  for (const c of dxComponents) byId.set(c.id, c);
  for (const c of customComponents) byId.set(c.id, c);
  for (const c of gravityComponents) byId.set(c.id, c);
  const components = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));

  return {
    source: 'ds',
    extractedAt: new Date().toISOString(),
    origin: {
      repoOrPackage: cfg.github,
      ref: gitRef(cfg.repo),
      figmaUrl: cfg.figma,
      notes: 'DevExtreme widgets with verified template usage (dx-* in .html, dx-notify via devextreme/ui/notify), custom Angular components (repo scan), and Gravity design-system entries from data/ds-gravity-components.json. Figma read-only reference.',
    },
    components,
    familiesGuess: Object.fromEntries(
      components.map((c) => [c.id, c._familyId ?? DS_TO_FAMILY[c.id] ?? c.selectorOrExport?.replace(/^app-|^mdds-|^ck-/, '') ?? c.id.replace(/^ds-|^dx-|^gravity-/, '')]),
    ),
    _stats: { dx: dxComponents.length, custom: customComponents.length, gravity: gravityComponents.length },
  };
}

function parseReactProps(content) {
  const props = [];
  const inline = content.match(/FC<\{([^}]+)\}>/s);
  if (inline) {
    for (const m of inline[1].matchAll(/(\w+)\??:\s*([^;,\n]+)/g)) {
      props.push({ name: m[1], type: m[2].trim(), default: null, required: !m[0].includes('?'), values: [], description: '' });
    }
  }
  return props;
}

function extractEs() {
  const cfg = SOURCES.es;
  const components = [];
  const commonDir = join(cfg.scanRoot, 'common');

  if (existsSync(commonDir)) {
    for (const f of readdirSync(commonDir)) {
      if (!f.endsWith('.tsx')) continue;
      const filePath = join(commonDir, f);
      const content = readFileSync(filePath, 'utf8');
      const name = basename(f, '.tsx');
      if (ES_SKIP_COMPONENTS.has(name)) continue;
      const props = parseReactProps(content);
      const autoDesign = extractDesignFromTailwind(content);

      components.push({
        id: `es-${name.replace(/([A-Z])/g, (m, c, i) => (i ? '-' : '') + c.toLowerCase())}`,
        displayName: name,
        category: 'other',
        framework: 'react',
        packageOrPath: `src/components/common/${f}`,
        selectorOrExport: name,
        usage: { instanceCount: null, fileCount: null, samplePaths: [filePath.replace(/\\/g, '/')] },
        api: { props, events: [], slots: [], methods: [], services: [] },
        design: autoDesign,
        ...(hasDesignData(autoDesign)
          ? { designMeta: designMetaFromCode('Auto-extracted from Tailwind className utilities') }
          : {}),
        a11y: { role: null, labelProps: [], notes: '' },
        migrateHint: 'unknown',
        confidence: props.length ? 'medium' : 'low',
        notes: '',
      });
    }
  }

  const iconsDir = join(cfg.scanRoot, 'icons');
  if (existsSync(iconsDir)) {
    for (const f of readdirSync(iconsDir).filter((x) => x.endsWith('.tsx'))) {
      components.push({
        id: `es-icon-${basename(f, '.tsx').replace(/Icon$/, '').toLowerCase()}`,
        displayName: basename(f, '.tsx'),
        category: 'media',
        framework: 'react',
        packageOrPath: `src/components/icons/${f}`,
        selectorOrExport: basename(f, '.tsx'),
        usage: { instanceCount: null, fileCount: null, samplePaths: [] },
        api: { props: [], events: [], slots: [], methods: [], services: [] },
        design: { colors: [], spacing: [], radius: [], typography: [], elevation: [], states: [] },
        a11y: { role: null, labelProps: [], notes: '' },
        migrateHint: 'unknown',
        confidence: 'low',
        notes: 'Icon component',
      });
    }
  }

  return {
    source: 'es',
    extractedAt: new Date().toISOString(),
    origin: {
      repoOrPackage: cfg.github,
      ref: gitRef(cfg.repo),
      figmaUrl: cfg.figma,
      notes: 'In-app React components under src/components. Figma read-only reference.',
    },
    components: components.sort((a, b) => a.id.localeCompare(b.id)),
    familiesGuess: Object.fromEntries(components.map((c) => [c.id, c.displayName.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '').toLowerCase()])),
  };
}

const DS_TO_FAMILY = {
  'dx-button': 'button',
  'dx-text-box': 'input',
  'dx-text-area': 'textarea',
  'dx-select-box': 'dropdown',
  'dx-tag-box': 'tag-input',
  'dx-check-box': 'checkbox',
  'dx-switch': 'switch',
  'dx-radio-group': 'radio-group',
  'dx-number-box': 'input-number',
  'dx-date-box': 'date-picker',
  'dx-color-box': 'color-picker',
  'dx-popup': 'modal',
  'dx-drawer': 'drawer',
  'dx-tabs': 'tabs',
  'dx-tab-panel': 'tabs',
  'dx-tooltip': 'tooltip',
  'dx-popover': 'popover',
  'dx-accordion': 'accordion',
  'dx-load-indicator': 'progress',
  'dx-load-panel': 'progress',
  'dx-progress-bar': 'progress',
  'dx-slider': 'slider',
  'dx-file-uploader': 'drop-uploader',
  'dx-data-grid': 'data-grid',
  'dx-pivot-grid': 'data-grid',
  'dx-tree-list': 'data-grid',
  'dx-tree-view': 'tree',
  'dx-notify': 'toast',
  'dx-context-menu': 'menu',
  'gravity-avatar': 'avatar',
};

const ES_SKIP_COMPONENTS = new Set(['Avatar']);

const ES_TO_FAMILY = {
  PillButton: 'button',
  RegularTextInput: 'input',
  DropDown: 'dropdown',
  DatePicker: 'date-picker',
  EmptyState: 'empty-state',
  NotificationSnackbar: 'toast',
  LoginPopup: 'modal',
  BreadcrumbNavigation: 'breadcrumb',
  Image: 'image',
  YearSelector: 'dropdown',
};

function buildCrosswalk(cg, ds, es) {
  const mappings = [];
  const seen = new Set();

  for (const c of cg.components) {
    const familyId = familyIdFromCg(c.id);
    mappings.push({ familyId, source: 'cg', sourceId: c.id, confidence: 'high', notes: '' });
    seen.add(`${familyId}:cg`);
  }

  for (const c of dsRaw.components) {
    const selector = c.selectorOrExport;
    const familyId = resolveFamilyId(
      c._familyId
        ?? DS_TO_FAMILY[c.id]
        ?? (selector ? DS_CUSTOM_TO_FAMILY[selector] : undefined)
        ?? c.id.replace(/^ds-/, '').replace(/^dx-/, '').replace(/^gravity-/, ''),
    );
    const isMapped = !!(c._familyId || DS_TO_FAMILY[c.id] || (selector && DS_CUSTOM_TO_FAMILY[selector]));
    let notes = '';
    if (c.framework === 'design-system') notes = 'Gravity Figma design-system component';
    else if (c.framework === 'angular' && c.id.startsWith('ds-')) notes = c.notes || 'Custom DS Angular component';
    mappings.push({
      familyId,
      source: 'ds',
      sourceId: c.id,
      confidence: isMapped ? 'high' : c.confidence ?? 'medium',
      notes,
    });
  }

  for (const c of es.components) {
    const familyId = resolveFamilyId(
      ES_TO_FAMILY[c.displayName] ?? c.displayName.replace(/([A-Z])/g, (m) => '-' + m.toLowerCase()).replace(/^-/, '').toLowerCase(),
    );
    mappings.push({ familyId, source: 'es', sourceId: c.id, confidence: ES_TO_FAMILY[c.displayName] ? 'high' : 'medium', notes: '' });
  }

  return {
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    figma: {
      cg: SOURCES.cg.figma,
      ds: SOURCES.ds.figma,
      es: SOURCES.es.figma,
    },
    mappings,
  };
}

const cg = extractCg();
const dsRaw = extractDs();
const es = extractEs();

function stripInternalFields(components) {
  return components.map(({ _familyId, _figmaUrl, ...rest }) => rest);
}

const ds = { ...dsRaw, components: stripInternalFields(dsRaw.components) };
const crosswalk = buildCrosswalk(cg, ds, es);

writeFileSync(join(dataDir, 'cg.raw.json'), JSON.stringify(cg, null, 2) + '\n');
writeFileSync(join(dataDir, 'ds.raw.json'), JSON.stringify(ds, null, 2) + '\n');
writeFileSync(join(dataDir, 'es.raw.json'), JSON.stringify(es, null, 2) + '\n');
writeFileSync(join(root, 'data', 'crosswalk.json'), JSON.stringify(crosswalk, null, 2) + '\n');

const dsStats = dsRaw._stats ?? { dx: 0, custom: 0, gravity: 0 };
console.log(`CG: ${cg.components.length} components (ref ${cg.origin.ref})`);
console.log(`DS: ${ds.components.length} total (${dsStats.dx} DevExtreme + ${dsStats.custom} custom Angular + ${dsStats.gravity} Gravity design-system)`);
console.log(`ES: ${es.components.length} React components`);
console.log(`Crosswalk: ${crosswalk.mappings.length} mappings`);
console.log('Figma URLs stored as read-only references in origin.figmaUrl');
