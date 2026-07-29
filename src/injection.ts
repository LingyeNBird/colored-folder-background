import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { ColorRegion } from './types';

const CUSTOM_CSS_EXTENSION_ID = 'be5invis.vscode-custom-css';
const CUSTOM_CSS_RELOAD_COMMAND = 'extension.updateCustomCSS';
const RUNTIME_FILE_NAME = 'explorer-backgrounds.js';

const RUNTIME_CSS = [
  '#workbench\\.view\\.explorer .monaco-list-rows {',
  '  isolation: isolate;',
  '}',
  '#workbench\\.view\\.explorer .monaco-list-row.cfb-region::before {',
  '  content: "";',
  '  position: absolute;',
  '  inset: 0;',
  '  z-index: 0;',
  '  pointer-events: none;',
  '  background-color: var(--cfb-background-color);',
  '}',
  '#workbench\\.view\\.explorer .monaco-list-row.cfb-region > .monaco-tl-row {',
  '  position: relative;',
  '  z-index: 2;',
  '}',
  '#workbench\\.view\\.explorer .monaco-list-row.cfb-region[aria-selected="true"]::before,',
  '#workbench\\.view\\.explorer .monaco-list-row.cfb-region.focused::before {',
  '  opacity: 0;',
  '}',
  '#workbench\\.view\\.explorer .monaco-list-row.cfb-region:hover::before {',
  '  opacity: 0.78;',
  '}',
  '#workbench\\.view\\.explorer .cfb-watermark-layer {',
  '  position: absolute;',
  '  inset: 0;',
  '  z-index: 1;',
  '  overflow: hidden;',
  '  pointer-events: none;',
  '}',
  '#workbench\\.view\\.explorer .cfb-watermark {',
  '  position: absolute;',
  '  display: grid;',
  '  color: var(--cfb-watermark-color);',
  '  font-family: var(--vscode-font-family);',
  '  font-weight: 700;',
  '  line-height: 1;',
  '  text-align: center;',
  '  user-select: none;',
  '}',
  '#workbench\\.view\\.explorer .cfb-watermark-cell {',
  '  display: flex;',
  '  align-items: center;',
  '  justify-content: center;',
  '  min-width: 0;',
  '  min-height: 0;',
  '}',
].join('\n');

export class CustomCssUnavailableError extends Error {
  public constructor() {
    super(
      'Colored Folder Background requires the "Custom CSS and JS Loader" extension (be5invis.vscode-custom-css).',
    );
    this.name = 'CustomCssUnavailableError';
  }
}

export class CustomCssBridge {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public async sync(regions: readonly ColorRegion[]): Promise<void> {
    await this.activateLoader();

    const runtimeUri = await this.runtimeUri();
    if (regions.length === 0) {
      await this.updateManagedImport(runtimeUri, false);
    } else {
      await fs.writeFile(runtimeUri.fsPath, buildInjectedRuntime(regions), 'utf8');
      await this.updateManagedImport(runtimeUri, true);
    }

    await vscode.commands.executeCommand(CUSTOM_CSS_RELOAD_COMMAND);
  }

  public async disable(): Promise<void> {
    await this.activateLoader();

    const runtimeUri = await this.runtimeUri();
    const changed = await this.updateManagedImport(runtimeUri, false);
    if (changed) {
      await vscode.commands.executeCommand(CUSTOM_CSS_RELOAD_COMMAND);
    }
  }

  private async activateLoader(): Promise<void> {
    const loader = vscode.extensions.getExtension(CUSTOM_CSS_EXTENSION_ID);
    if (!loader) {
      throw new CustomCssUnavailableError();
    }

    await loader.activate();
  }

  private async runtimeUri(): Promise<vscode.Uri> {
    await fs.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
    return vscode.Uri.file(path.join(this.context.globalStorageUri.fsPath, RUNTIME_FILE_NAME));
  }


  private async updateManagedImport(runtimeUri: vscode.Uri, include: boolean): Promise<boolean> {
    const scopeResource = vscode.workspace.workspaceFolders?.[0]?.uri;
    const configuration = vscode.workspace.getConfiguration('vscode_custom_css', scopeResource);
    const configuredImports = configuration.get<unknown>('imports', []);
    const imports = Array.isArray(configuredImports)
      ? configuredImports.filter((value): value is string => typeof value === 'string')
      : [];
    const remaining = imports.filter(value => !isManagedImport(value, runtimeUri));
    const next = include ? [...remaining, runtimeUri.toString()] : remaining;

    if (imports.length === next.length && imports.every((value, index) => value === next[index])) {
      return false;
    }

    const inspection = configuration.inspect<string[]>('imports');
    const target =
      inspection?.workspaceFolderValue !== undefined
        ? vscode.ConfigurationTarget.WorkspaceFolder
        : inspection?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;

    await configuration.update('imports', next, target);
    return true;
  }
}


function isManagedImport(value: string, runtimeUri: vscode.Uri): boolean {
  if (value === runtimeUri.toString()) {
    return true;
  }

  try {
    const candidate = vscode.Uri.parse(value);
    return process.platform === 'win32'
      ? candidate.fsPath.toLocaleLowerCase() === runtimeUri.fsPath.toLocaleLowerCase()
      : candidate.fsPath === runtimeUri.fsPath;
  } catch {
    return false;
  }
}


export function buildInjectedRuntime(regions: readonly ColorRegion[]): string {
  const payload = regions.map(region => ({
    id: region.uri,
    fsPath: region.fsPath,
    color: region.color,
    opacity: region.opacity,
    recursive: region.recursive,
    watermark: region.watermark,
    watermarkStyle: region.watermarkStyle,
  }));
  const serializedRegions = serializeForInlineScript(payload);
  const serializedCss = serializeForInlineScript(RUNTIME_CSS);
  const caseSensitive = process.platform !== 'win32';

  return `(() => {
  'use strict';

  const runtimeKey = '__coloredFolderBackgroundRuntimeV1__';
  const previous = globalThis[runtimeKey];
  if (previous && typeof previous.dispose === 'function') {
    previous.dispose();
  }

  const configuredRegions = ${serializedRegions};
  const runtimeCss = ${serializedCss};
  const caseSensitive = ${caseSensitive};
  const styleId = 'colored-folder-background-runtime-style';
  let observer;
  let scheduled = false;
  let started = false;

  function normalizePath(value) {
    const windowsSeparator = String.fromCharCode(92);
    let normalized = String(value || '').split(windowsSeparator).join('/');
    while (normalized.includes('//')) {
      normalized = normalized.replace('//', '/');
    }
    while (normalized.length > 1 && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }
    return caseSensitive ? normalized : normalized.toLocaleLowerCase();
  }

  function colorToRgba(hex, opacity) {
    const source = String(hex || '').replace('#', '');
    const red = Number.parseInt(source.slice(0, 2), 16);
    const green = Number.parseInt(source.slice(2, 4), 16);
    const blue = Number.parseInt(source.slice(4, 6), 16);
    const alpha = Math.max(0, Math.min(1, Number(opacity)));
    return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha + ')';
  }

  const activeRegions = configuredRegions
    .map(region => {
      const opacity = Math.max(0, Math.min(1, Number(region.opacity)));
      const typography =
        region.watermarkStyle && typeof region.watermarkStyle === 'object'
          ? region.watermarkStyle
          : {};
      const configuredFontOpacity = Number(typography.fontOpacity);
      const configuredStrokeOpacity = Number(typography.strokeOpacity);
      const configuredStrokeWidth = Number(typography.strokeWidth);
      const fontOpacity = Number.isFinite(configuredFontOpacity)
        ? Math.max(0, Math.min(1, configuredFontOpacity))
        : Math.max(0.24, Math.min(0.64, opacity + 0.18));
      const strokeOpacity = Number.isFinite(configuredStrokeOpacity)
        ? Math.max(0, Math.min(1, configuredStrokeOpacity))
        : 0.42;
      const strokeWidth = Number.isFinite(configuredStrokeWidth)
        ? Math.max(0, Math.min(6, configuredStrokeWidth))
        : 0;
      const fontColor =
        typeof typography.fontColor === 'string' ? typography.fontColor : region.color;
      const strokeColor =
        typeof typography.strokeColor === 'string' ? typography.strokeColor : '#000000';

      return {
        id: region.id,
        path: normalizePath(region.fsPath),
        recursive: Boolean(region.recursive),
        backgroundColor: colorToRgba(region.color, opacity),
        watermark: String(region.watermark || ''),
        fontFamily: typeof typography.fontFamily === 'string' ? typography.fontFamily : '',
        fontColor: colorToRgba(fontColor, fontOpacity),
        strokeColor: colorToRgba(strokeColor, strokeOpacity),
        strokeWidth,
      };
    })
    .filter(region => region.path)
    .sort((left, right) => right.path.length - left.path.length);

  function installStyle() {
    document.getElementById(styleId)?.remove();
    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = runtimeCss;
    (document.head || document.documentElement).appendChild(style);
  }

  function explorerPathForRow(row) {
    const item = row.querySelector('.monaco-tl-contents .explorer-item[aria-label]');
    if (!(item instanceof HTMLElement)) {
      return '';
    }

    const rawLabel = item.getAttribute('aria-label') || '';
    const decorationStart = rawLabel.indexOf(' • ');
    return normalizePath(decorationStart === -1 ? rawLabel : rawLabel.slice(0, decorationStart));
  }

  function regionForPath(resourcePath) {
    for (const region of activeRegions) {
      if (
        resourcePath === region.path ||
        (region.recursive && resourcePath.startsWith(region.path + '/'))
      ) {
        return region;
      }
    }
    return undefined;
  }

  function clearRow(row) {
    row.classList.remove('cfb-region');
    delete row.dataset.cfbRegion;
    row.style.removeProperty('--cfb-background-color');
  }

  function layoutForWatermark(text, width, height) {
    const characters = Array.from(text);
    if (characters.length === 0) {
      return undefined;
    }

    const padding = Math.max(6, Math.min(24, Math.floor(Math.min(width, height) * 0.06)));
    const availableWidth = Math.max(0, width - padding * 2);
    const availableHeight = Math.max(0, height - padding * 2);
    if (availableWidth === 0 || availableHeight === 0) {
      return undefined;
    }

    const verticalSize = Math.min(availableWidth, availableHeight / characters.length);
    const columns = characters.length === 1 || verticalSize >= 24 ? 1 : 2;
    const rows = Math.ceil(characters.length / columns);
    const unspacedSize = Math.min(availableWidth / columns, availableHeight / rows);
    const gap = columns === 1 ? 0 : Math.max(4, Math.min(24, Math.floor(unspacedSize * 0.16)));
    const fontSize = Math.floor(
      Math.min(
        (availableWidth - gap * (columns - 1)) / columns,
        (availableHeight - gap * (rows - 1)) / rows,
      ),
    );
    if (fontSize < 12) {
      return undefined;
    }

    return { characters, columns, rows, padding, gap, fontSize };
  }

  function watermarkLayerFor(list) {
    for (const child of list.children) {
      if (child instanceof HTMLElement && child.classList.contains('cfb-watermark-layer')) {
        return child;
      }
    }
    return undefined;
  }

  function renderWatermarksForList(list, records) {
    const groups = new Map();
    for (const record of records) {
      if (record.row.parentElement !== list || !record.region.watermark) {
        continue;
      }

      const existing = groups.get(record.region.id);
      if (existing) {
        existing.rows.push(record.row);
      } else {
        groups.set(record.region.id, { region: record.region, rows: [record.row] });
      }
    }

    const width = list.clientWidth || list.offsetWidth;
    const descriptors = [];
    for (const group of groups.values()) {
      let top = Number.POSITIVE_INFINITY;
      let bottom = Number.NEGATIVE_INFINITY;
      for (const row of group.rows) {
        const rowTop = row.offsetTop;
        const rowHeight = row.offsetHeight || Number.parseFloat(row.style.height) || 0;
        top = Math.min(top, rowTop);
        bottom = Math.max(bottom, rowTop + rowHeight);
      }

      const height = bottom - top;
      const layout = layoutForWatermark(group.region.watermark, width, height);
      if (layout) {
        descriptors.push({ region: group.region, top, height, layout });
      }
    }

    let layer = watermarkLayerFor(list);
    if (descriptors.length === 0) {
      layer?.remove();
      return;
    }

    const signature = descriptors
      .map(descriptor =>
        [
          descriptor.region.id,
          descriptor.region.watermark,
          descriptor.region.fontFamily,
          descriptor.region.fontColor,
          descriptor.region.strokeColor,
          descriptor.region.strokeWidth,
          descriptor.top,
          descriptor.height,
          descriptor.layout.columns,
          descriptor.layout.rows,
          descriptor.layout.fontSize,
          descriptor.layout.gap,
          descriptor.layout.padding,
        ].join(':'),
      )
      .join('|');
    if (layer && layer.dataset.cfbSignature === signature) {
      return;
    }

    if (!layer) {
      layer = document.createElement('div');
      layer.className = 'cfb-watermark-layer';
      list.appendChild(layer);
    }

    layer.dataset.cfbSignature = signature;
    layer.replaceChildren();
    for (const descriptor of descriptors) {
      const watermark = document.createElement('div');
      watermark.className = 'cfb-watermark';
      watermark.style.top = descriptor.top + 'px';
      watermark.style.height = descriptor.height + 'px';
      watermark.style.left = '0';
      watermark.style.width = '100%';
      watermark.style.padding = descriptor.layout.padding + 'px';
      watermark.style.color = descriptor.region.fontColor;
      if (descriptor.region.fontFamily) {
        watermark.style.fontFamily = descriptor.region.fontFamily;
      }
      watermark.style.webkitTextStroke =
        descriptor.region.strokeWidth > 0
          ? descriptor.region.strokeWidth + 'px ' + descriptor.region.strokeColor
          : '';
      watermark.style.fontSize = descriptor.layout.fontSize + 'px';
      watermark.style.gridTemplateColumns =
        'repeat(' + descriptor.layout.columns + ', minmax(0, 1fr))';
      watermark.style.gridTemplateRows =
        'repeat(' + descriptor.layout.rows + ', minmax(0, 1fr))';
      watermark.style.columnGap = descriptor.layout.gap + 'px';
      watermark.style.rowGap = descriptor.layout.gap + 'px';

      for (const character of descriptor.layout.characters) {
        const cell = document.createElement('span');
        cell.className = 'cfb-watermark-cell';
        cell.textContent = character;
        watermark.appendChild(cell);
      }

      layer.appendChild(watermark);
    }
  }

  function paint() {
    const explorer = document.getElementById('workbench.view.explorer');
    if (!explorer) {
      return;
    }

    const records = [];
    for (const row of explorer.querySelectorAll('.monaco-list-row')) {
      if (!(row instanceof HTMLElement)) {
        continue;
      }

      const region = regionForPath(explorerPathForRow(row));
      if (!region) {
        clearRow(row);
        continue;
      }

      row.classList.add('cfb-region');
      row.dataset.cfbRegion = region.id;
      row.style.setProperty('--cfb-background-color', region.backgroundColor);
      records.push({ row, region });
    }

    for (const list of explorer.querySelectorAll('.monaco-list-rows')) {
      if (list instanceof HTMLElement) {
        renderWatermarksForList(list, records);
      }
    }
  }

  function schedulePaint() {
    if (scheduled) {
      return;
    }

    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      paint();
    });
  }

  function watermarkNode(node) {
    return (
      node instanceof HTMLElement &&
      (node.classList.contains('cfb-watermark-layer') ||
        node.classList.contains('cfb-watermark') ||
        node.classList.contains('cfb-watermark-cell') ||
        Boolean(node.closest('.cfb-watermark-layer')))
    );
  }

  function mutationNeedsPaint(mutation) {
    if (mutation.type === 'attributes') {
      return true;
    }

    const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
    return nodes.some(node => !watermarkNode(node));
  }

  function start() {
    if (started) {
      return;
    }

    started = true;
    installStyle();
    observer = new MutationObserver(mutations => {
      if (mutations.some(mutationNeedsPaint)) {
        schedulePaint();
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
    schedulePaint();
  }

  function dispose() {
    document.removeEventListener('DOMContentLoaded', start);
    observer?.disconnect();
    document.getElementById(styleId)?.remove();
    for (const row of document.querySelectorAll('.monaco-list-row.cfb-region')) {
      if (row instanceof HTMLElement) {
        clearRow(row);
      }
    }
    for (const layer of document.querySelectorAll('.cfb-watermark-layer')) {
      layer.remove();
    }
  }

  globalThis[runtimeKey] = { dispose };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
`;
}

function serializeForInlineScript(value: unknown): string {
  let serialized = JSON.stringify(value) ?? 'null';
  serialized = serialized.replace(/</g, '\\u003C');
  serialized = serialized.replace(/>/g, '\\u003E');
  serialized = serialized.replace(/&/g, '\\u0026');
  serialized = serialized.replace(/\u2028/g, '\\u2028');
  serialized = serialized.replace(/\u2029/g, '\\u2029');
  return serialized;
}
