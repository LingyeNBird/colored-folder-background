import * as vscode from 'vscode';
import { CustomCssBridge, CustomCssUnavailableError } from './injection';
import { RegionStore } from './region-store';
import { EDITOR_TEXT_BY_LOCALE, ExtensionLocale, LocaleStore, localizedText } from './localization';
import {
  ColorRegion,
  defaultWatermarkStyle,
  normalizeFontFamily,
  normalizeHexColor,
  normalizeOpacity,
  normalizeStrokeWidth,
  normalizeWatermarkText,
  WatermarkStyle,
} from './types';

export function activate(context: vscode.ExtensionContext): void {
  const store = new RegionStore(context);
  const bridge = new CustomCssBridge(context);
  const localeStore = new LocaleStore(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('coloredFolderBackground.setColor', async (resource?: vscode.Uri) => {
      await configureResource(resource, store, bridge, localeStore);
    }),
    vscode.commands.registerCommand('coloredFolderBackground.removeColor', async (resource?: vscode.Uri) => {
      await removeResource(resource, store, bridge, localeStore);
    }),
    vscode.commands.registerCommand('coloredFolderBackground.applyInjection', async () => {
      await applyConfiguredRegions(store, bridge, localeStore);
    }),
    vscode.commands.registerCommand('coloredFolderBackground.disableInjection', async () => {
      try {
        await bridge.disable();
        void vscode.window.showInformationMessage(localizedText(localeStore.get()).native.injectionRemoved);
      } catch (error) {
        showBridgeError(error, localeStore.get());
      }
    }),
    vscode.commands.registerCommand('coloredFolderBackground.clearAllColors', async () => {
      const text = localizedText(localeStore.get()).native;
      const confirmation = await vscode.window.showWarningMessage(
        text.clearConfirmation,
        { modal: true },
        text.clearAction,
      );
      if (confirmation !== text.clearAction) {
        return;
      }

      await store.clear();
      await applyConfiguredRegions(store, bridge, localeStore);
    }),
  );
}

async function configureResource(
  resource: vscode.Uri | undefined,
  store: RegionStore,
  bridge: CustomCssBridge,
  localeStore: LocaleStore,
): Promise<void> {
  const locale = localeStore.get();
  const text = localizedText(locale).native;
  if (!resource || resource.scheme !== 'file') {
    void vscode.window.showErrorMessage(text.rightClickToSet);
    return;
  }

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(resource);
  } catch (error) {
    const detail = locale === 'en' && error instanceof Error ? ` ${error.message}` : '';
    void vscode.window.showErrorMessage(`${text.resourceUnreadable}${detail}`);
    return;
  }

  const recursive = (stat.type & vscode.FileType.Directory) !== 0;
  const existing = store.get(resource);
  const initialLocale = locale;
  const panel = vscode.window.createWebviewPanel(
    'coloredFolderBackground.editor',
    recursive
      ? localizedText(initialLocale).native.folderTitle
      : localizedText(initialLocale).native.fileTitle,
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: false,
    },
  );
  panel.webview.html = renderColorEditor(
    panel.webview,
    resource,
    existing,
    recursive,
    initialLocale,
  );
  const messageListener = panel.webview.onDidReceiveMessage(async (rawMessage: unknown) => {
    if (
      !rawMessage ||
      typeof rawMessage !== 'object' ||
      !('type' in rawMessage)
    ) {
      return;
    }

    const messageType = rawMessage.type;
    if (messageType === 'setLocale') {
      const locale = await localeStore.set('locale' in rawMessage ? rawMessage.locale : undefined);
      panel.title = recursive
        ? localizedText(locale).native.folderTitle
        : localizedText(locale).native.fileTitle;
      return;
    }

    const messageText = localizedText(localeStore.get()).native;
    if (messageType === 'cancel') {
      panel.dispose();
      return;
    }

    if (messageType === 'remove') {
      const removed = await store.remove(resource);
      if (!removed) {
        void vscode.window.showInformationMessage(messageText.noSavedSettings);
        panel.dispose();
        return;
      }

      if (await applyConfiguredRegions(store, bridge, localeStore)) {
        panel.dispose();
      }
      return;
    }

    if (messageType !== 'save') {
      return;
    }

    const color = normalizeHexColor('color' in rawMessage ? rawMessage.color : undefined);
    const rawOpacity = 'opacity' in rawMessage ? rawMessage.opacity : undefined;
    const sliderValue = typeof rawOpacity === 'number' ? rawOpacity : Number(rawOpacity);
    const opacity = normalizeOpacity(sliderValue / 100);
    const watermark = normalizeWatermarkText(
      'watermark' in rawMessage ? rawMessage.watermark : '',
    );
    if (!color || opacity === undefined || watermark === undefined) {
      void vscode.window.showErrorMessage(messageText.invalidBackground);
      return;
    }

    const defaults = defaultWatermarkStyle(color, opacity);
    const rawFontFamily = 'fontFamily' in rawMessage ? rawMessage.fontFamily : defaults.fontFamily;
    const rawFontColor = 'fontColor' in rawMessage ? rawMessage.fontColor : defaults.fontColor;
    const rawFontOpacity =
      'fontOpacity' in rawMessage ? rawMessage.fontOpacity : defaults.fontOpacity * 100;
    const rawStrokeColor =
      'strokeColor' in rawMessage ? rawMessage.strokeColor : defaults.strokeColor;
    const rawStrokeOpacity =
      'strokeOpacity' in rawMessage ? rawMessage.strokeOpacity : defaults.strokeOpacity * 100;
    const rawStrokeWidth =
      'strokeWidth' in rawMessage ? rawMessage.strokeWidth : defaults.strokeWidth;
    const fontFamily = normalizeFontFamily(rawFontFamily);
    const fontColor = normalizeHexColor(rawFontColor);
    const fontOpacity = normalizeOpacity(
      (typeof rawFontOpacity === 'number' ? rawFontOpacity : Number(rawFontOpacity)) / 100,
    );
    const strokeColor = normalizeHexColor(rawStrokeColor);
    const strokeOpacity = normalizeOpacity(
      (typeof rawStrokeOpacity === 'number' ? rawStrokeOpacity : Number(rawStrokeOpacity)) / 100,
    );
    const strokeWidth = normalizeStrokeWidth(
      typeof rawStrokeWidth === 'number' ? rawStrokeWidth : Number(rawStrokeWidth),
    );

    if (
      fontFamily === undefined ||
      !fontColor ||
      fontOpacity === undefined ||
      !strokeColor ||
      strokeOpacity === undefined ||
      strokeWidth === undefined
    ) {
      void vscode.window.showErrorMessage(messageText.invalidTypography);
      return;
    }

    const watermarkStyle: WatermarkStyle = {
      fontFamily,
      fontColor,
      fontOpacity,
      strokeColor,
      strokeOpacity,
      strokeWidth,
    };
    await store.upsert(resource, color, opacity, watermark, watermarkStyle, recursive);
    if (await applyConfiguredRegions(store, bridge, localeStore)) {
      panel.dispose();
    }
  });

  panel.onDidDispose(() => messageListener.dispose());
}

async function removeResource(
  resource: vscode.Uri | undefined,
  store: RegionStore,
  bridge: CustomCssBridge,
  localeStore: LocaleStore,
): Promise<void> {
  const text = localizedText(localeStore.get()).native;
  if (!resource || resource.scheme !== 'file') {
    void vscode.window.showErrorMessage(text.rightClickToSet);
    return;
  }

  const removed = await store.remove(resource);
  if (!removed) {
    void vscode.window.showInformationMessage(text.noSavedSettings);
    return;
  }

  await applyConfiguredRegions(store, bridge, localeStore);
}

async function applyConfiguredRegions(
  store: RegionStore,
  bridge: CustomCssBridge,
  localeStore: LocaleStore,
): Promise<boolean> {
  const regions = store.list();
  const text = localizedText(localeStore.get()).native;

  try {
    await bridge.sync(regions);
    const summary = regions.length === 0 ? text.noRegions : text.saved;
    void vscode.window.showInformationMessage(summary);
    return true;
  } catch (error) {
    showBridgeError(error, localeStore.get());
    return false;
  }
}

function showBridgeError(error: unknown, locale: ExtensionLocale): void {
  const text = localizedText(locale).native;
  if (error instanceof CustomCssUnavailableError) {
    void vscode.window.showErrorMessage(text.loaderUnavailable);
    return;
  }

  const detail = locale === 'en' && error instanceof Error ? ` ${error.message}` : '';
  void vscode.window.showErrorMessage(`${text.injectionFailed}${detail}`);
}

function renderColorEditor(
  webview: vscode.Webview,
  resource: vscode.Uri,
  existing: ColorRegion | undefined,
  recursive: boolean,
  locale: ExtensionLocale,
): string {
  const nonce = createNonce();
  const initialColor = existing?.color ?? '#3B82F6';
  const initialOpacity = Math.round((existing?.opacity ?? 0.28) * 100);
  const initialWatermark = existing?.watermark ?? '';
  const watermarkStyle =
    existing?.watermarkStyle ?? defaultWatermarkStyle(initialColor, initialOpacity / 100);
  const initialFontFamily = watermarkStyle.fontFamily;
  const initialFontColor = watermarkStyle.fontColor;
  const initialFontOpacity = Math.round(watermarkStyle.fontOpacity * 100);
  const initialStrokeColor = watermarkStyle.strokeColor;
  const initialStrokeOpacity = Math.round(watermarkStyle.strokeOpacity * 100);
  const initialStrokeWidth = watermarkStyle.strokeWidth;
  const workspacePath = vscode.workspace.asRelativePath(resource, false);
  const resourceLabel = workspacePath === resource.fsPath ? resource.fsPath : workspacePath;
  const copy = localizedText(locale).editor;
  const scopeCopy = recursive ? copy.folderScope : copy.fileScope;
  const removeButton = existing
    ? `<button id="remove" class="danger" type="button" data-i18n="remove">${escapeHtml(copy.remove)}</button>`
    : '';
  const translations = JSON.stringify(EDITOR_TEXT_BY_LOCALE);

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
  <title>${escapeHtml(copy.title)}</title>
  <style nonce="${nonce}">
    :root { color-scheme: light dark; }
    body {
      box-sizing: border-box;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.5;
      margin: 0;
      padding: 24px;
    }
    *, *::before, *::after { box-sizing: inherit; }
    .heading { align-items: flex-start; display: flex; gap: 16px; justify-content: space-between; margin: 0 0 8px; }
    h1 { font-size: 1.25rem; margin: 0; }
    .language-control { align-items: center; display: flex; flex: 0 0 auto; gap: 8px; }
    select, input[type="text"] { background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, transparent); color: var(--vscode-input-foreground); font: inherit; padding: 7px 8px; }
    select { min-width: 108px; }
    .path { color: var(--vscode-descriptionForeground); margin: 0 0 20px; overflow-wrap: anywhere; }
    .scope { margin: 0 0 24px; }
    .field { display: grid; gap: 8px; margin: 0 0 20px; }
    .color-row { align-items: center; display: flex; gap: 12px; }
    input[type="color"] { background: transparent; border: 0; height: 38px; padding: 0; width: 60px; }
    input[type="text"] { width: 100%; }
    .hint { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
    input[type="range"] { accent-color: var(--vscode-button-background); flex: 1; }
    .typography { border: 1px solid var(--vscode-widget-border, transparent); border-radius: 4px; margin: 0 0 20px; padding: 16px; }
    .typography legend { color: var(--vscode-descriptionForeground); padding: 0 6px; }
    .style-grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
    .preview {
      align-items: center;
      background: rgba(59, 130, 246, 0.28);
      border: 1px solid var(--vscode-widget-border, transparent);
      border-radius: 4px;
      display: flex;
      justify-content: center;
      min-height: 112px;
      overflow: hidden;
      padding: 16px;
      text-align: center;
    }
    .preview > span { color: var(--vscode-foreground); font-size: 2rem; font-weight: 700; line-height: 1; overflow-wrap: anywhere; }
    .actions { align-items: center; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 28px; }
    button {
      border: 1px solid transparent;
      border-radius: 2px;
      cursor: pointer;
      font: inherit;
      padding: 6px 12px;
    }
    .primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
    .primary:hover { background: var(--vscode-button-hoverBackground); }
    .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .danger { background: transparent; border-color: var(--vscode-inputValidation-errorBorder); color: var(--vscode-errorForeground); margin-left: auto; }
    @media (max-width: 420px) {
      .heading { align-items: stretch; flex-direction: column; }
      .language-control { justify-content: space-between; }
    }
  </style>
</head>
<body>
  <header class="heading">
    <h1 data-i18n="title">${escapeHtml(copy.title)}</h1>
    <label class="language-control" for="locale">
      <span data-i18n="language">${escapeHtml(copy.language)}</span>
      <select id="locale">
        <option value="zh-CN"${locale === 'zh-CN' ? ' selected' : ''}>中文</option>
        <option value="en"${locale === 'en' ? ' selected' : ''}>English</option>
      </select>
    </label>
  </header>
  <p class="path">${escapeHtml(resourceLabel)}</p>
  <p id="scope" class="scope">${escapeHtml(scopeCopy)}</p>
  <form id="editor-form">
    <label class="field" for="color">
      <span data-i18n="backgroundColor">${escapeHtml(copy.backgroundColor)}</span>
      <span class="color-row">
        <input id="color" type="color" value="${initialColor}" />
        <output id="color-value" for="color">${initialColor}</output>
      </span>
    </label>
    <label class="field" for="opacity">
      <span><span data-i18n="backgroundOpacity">${escapeHtml(copy.backgroundOpacity)}</span><span data-i18n="separator">${escapeHtml(copy.separator)}</span><output id="opacity-value" for="opacity">${initialOpacity}%</output></span>
      <input id="opacity" type="range" min="0" max="100" step="1" value="${initialOpacity}" />
    </label>
    <label class="field" for="watermark">
      <span data-i18n="backgroundText">${escapeHtml(copy.backgroundText)}</span>
      <input id="watermark" type="text" maxlength="48" value="${escapeHtml(initialWatermark)}" placeholder="${escapeHtml(copy.watermarkPlaceholder)}" data-i18n-placeholder="watermarkPlaceholder" />
      <span class="hint" data-i18n="watermarkHint">${escapeHtml(copy.watermarkHint)}</span>
    </label>
    <fieldset class="typography">
      <legend data-i18n="typography">${escapeHtml(copy.typography)}</legend>
      <label class="field" for="font-family">
        <span data-i18n="fontFamily">${escapeHtml(copy.fontFamily)}</span>
        <input id="font-family" type="text" maxlength="160" list="font-family-options" value="${escapeHtml(initialFontFamily)}" placeholder="${escapeHtml(copy.fontPlaceholder)}" data-i18n-placeholder="fontPlaceholder" />
        <span class="hint" data-i18n="fontFamilyHint">${escapeHtml(copy.fontFamilyHint)}</span>
      </label>
      <datalist id="font-family-options">
        <option value="Microsoft YaHei, sans-serif"></option>
        <option value="Microsoft YaHei UI, sans-serif"></option>
        <option value="Segoe UI, sans-serif"></option>
        <option value="Cascadia Mono, monospace"></option>
        <option value="Consolas, monospace"></option>
        <option value="Arial, sans-serif"></option>
      </datalist>
      <div class="style-grid">
        <label class="field" for="font-color">
          <span data-i18n="textColor">${escapeHtml(copy.textColor)}</span>
          <span class="color-row">
            <input id="font-color" type="color" value="${initialFontColor}" />
            <output id="font-color-value" for="font-color">${initialFontColor}</output>
          </span>
        </label>
        <label class="field" for="font-opacity">
          <span><span data-i18n="textOpacity">${escapeHtml(copy.textOpacity)}</span><span data-i18n="separator">${escapeHtml(copy.separator)}</span><output id="font-opacity-value" for="font-opacity">${initialFontOpacity}%</output></span>
          <input id="font-opacity" type="range" min="0" max="100" step="1" value="${initialFontOpacity}" />
        </label>
      </div>
      <div class="style-grid">
        <label class="field" for="stroke-width">
          <span><span data-i18n="outlineWidth">${escapeHtml(copy.outlineWidth)}</span><span data-i18n="separator">${escapeHtml(copy.separator)}</span><output id="stroke-width-value" for="stroke-width">${initialStrokeWidth}px</output></span>
          <input id="stroke-width" type="range" min="0" max="6" step="0.25" value="${initialStrokeWidth}" />
        </label>
        <label class="field" for="stroke-color">
          <span data-i18n="outlineColor">${escapeHtml(copy.outlineColor)}</span>
          <span class="color-row">
            <input id="stroke-color" type="color" value="${initialStrokeColor}" />
            <output id="stroke-color-value" for="stroke-color">${initialStrokeColor}</output>
          </span>
        </label>
      </div>
      <label class="field" for="stroke-opacity">
        <span><span data-i18n="outlineOpacity">${escapeHtml(copy.outlineOpacity)}</span><span data-i18n="separator">${escapeHtml(copy.separator)}</span><output id="stroke-opacity-value" for="stroke-opacity">${initialStrokeOpacity}%</output></span>
        <input id="stroke-opacity" type="range" min="0" max="100" step="1" value="${initialStrokeOpacity}" />
      </label>
    </fieldset>
    <section id="preview" class="preview" aria-label="${escapeHtml(copy.previewAria)}"><span id="preview-text">${escapeHtml(copy.previewPlaceholder)}</span></section>
    <div class="actions">
      <button class="primary" type="submit" data-i18n="save">${escapeHtml(copy.save)}</button>
      <button id="cancel" class="secondary" type="button" data-i18n="cancel">${escapeHtml(copy.cancel)}</button>
      ${removeButton}
    </div>
  </form>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const translations = ${translations};
    const isRecursive = ${JSON.stringify(recursive)};
    const color = document.getElementById('color');
    const opacity = document.getElementById('opacity');
    const colorValue = document.getElementById('color-value');
    const opacityValue = document.getElementById('opacity-value');
    const watermark = document.getElementById('watermark');
    const fontFamily = document.getElementById('font-family');
    const fontColor = document.getElementById('font-color');
    const fontColorValue = document.getElementById('font-color-value');
    const fontOpacity = document.getElementById('font-opacity');
    const fontOpacityValue = document.getElementById('font-opacity-value');
    const strokeWidth = document.getElementById('stroke-width');
    const strokeWidthValue = document.getElementById('stroke-width-value');
    const strokeColor = document.getElementById('stroke-color');
    const strokeColorValue = document.getElementById('stroke-color-value');
    const strokeOpacity = document.getElementById('stroke-opacity');
    const strokeOpacityValue = document.getElementById('stroke-opacity-value');
    const preview = document.getElementById('preview');
    const previewText = document.getElementById('preview-text');
    const scope = document.getElementById('scope');
    const localeSelect = document.getElementById('locale');
    let currentText = translations[${JSON.stringify(locale)}] || translations['zh-CN'];

    function rgbaFor(hex, percentage) {
      const source = hex.slice(1);
      const red = Number.parseInt(source.slice(0, 2), 16);
      const green = Number.parseInt(source.slice(2, 4), 16);
      const blue = Number.parseInt(source.slice(4, 6), 16);
      return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + Number(percentage) / 100 + ')';
    }

    function formatPixels(value) {
      return Number(value).toFixed(2).replace(/\.?0+$/, '') + 'px';
    }

    function updatePreview() {
      colorValue.textContent = color.value.toUpperCase();
      opacityValue.textContent = opacity.value + '%';
      fontColorValue.textContent = fontColor.value.toUpperCase();
      fontOpacityValue.textContent = fontOpacity.value + '%';
      strokeColorValue.textContent = strokeColor.value.toUpperCase();
      strokeOpacityValue.textContent = strokeOpacity.value + '%';
      strokeWidthValue.textContent = formatPixels(strokeWidth.value);
      preview.style.backgroundColor = rgbaFor(color.value, opacity.value);
      previewText.textContent = watermark.value || currentText.previewPlaceholder;
      previewText.style.fontFamily = fontFamily.value || 'var(--vscode-font-family)';
      previewText.style.color = rgbaFor(fontColor.value, fontOpacity.value);
      previewText.style.webkitTextStroke =
        Number(strokeWidth.value) > 0
          ? formatPixels(strokeWidth.value) + ' ' + rgbaFor(strokeColor.value, strokeOpacity.value)
          : '';
    }

    function applyLocale(nextLocale) {
      currentText = translations[nextLocale] || translations['zh-CN'];
      document.documentElement.lang = nextLocale;
      document.title = currentText.title;
      localeSelect.value = nextLocale;
      for (const element of document.querySelectorAll('[data-i18n]')) {
        const key = element.getAttribute('data-i18n');
        const value = key ? currentText[key] : undefined;
        if (value) {
          element.textContent = value;
        }
      }
      for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
        const key = element.getAttribute('data-i18n-placeholder');
        const value = key ? currentText[key] : undefined;
        if (value) {
          element.setAttribute('placeholder', value);
        }
      }
      scope.textContent = isRecursive ? currentText.folderScope : currentText.fileScope;
      preview.setAttribute('aria-label', currentText.previewAria);
      updatePreview();
    }

    for (const control of [color, opacity, watermark, fontFamily, fontColor, fontOpacity, strokeWidth, strokeColor, strokeOpacity]) {
      control.addEventListener('input', updatePreview);
    }
    localeSelect.addEventListener('change', () => {
      applyLocale(localeSelect.value);
      vscode.postMessage({ type: 'setLocale', locale: localeSelect.value });
    });
    document.getElementById('editor-form').addEventListener('submit', event => {
      event.preventDefault();
      vscode.postMessage({
        type: 'save',
        color: color.value,
        opacity: Number(opacity.value),
        watermark: watermark.value,
        fontFamily: fontFamily.value,
        fontColor: fontColor.value,
        fontOpacity: Number(fontOpacity.value),
        strokeColor: strokeColor.value,
        strokeOpacity: Number(strokeOpacity.value),
        strokeWidth: Number(strokeWidth.value),
      });
    });
    document.getElementById('cancel').addEventListener('click', () => vscode.postMessage({ type: 'cancel' }));
    document.getElementById('remove')?.addEventListener('click', () => vscode.postMessage({ type: 'remove' }));
    applyLocale(${JSON.stringify(locale)});
  </script>
</body>
</html>`;
}

function createNonce(): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';

  for (let index = 0; index < 32; index += 1) {
    nonce += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return nonce;
}

function escapeHtml(value: string): string {
  const escaped = value.replace(/&/g, '&amp;');
  return escaped
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function deactivate(): void {
  // The injected runtime persists independently until the CSS loader reloads or disables it.
}
