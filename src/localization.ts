import * as vscode from 'vscode';

export type ExtensionLocale = 'zh-CN' | 'en';

export interface EditorText {
  title: string;
  language: string;
  folderScope: string;
  fileScope: string;
  backgroundColor: string;
  backgroundOpacity: string;
  separator: string;
  backgroundText: string;
  watermarkPlaceholder: string;
  watermarkHint: string;
  typography: string;
  fontFamily: string;
  fontPlaceholder: string;
  fontFamilyHint: string;
  textColor: string;
  textOpacity: string;
  outlineWidth: string;
  outlineColor: string;
  outlineOpacity: string;
  previewAria: string;
  previewPlaceholder: string;
  save: string;
  cancel: string;
  remove: string;
}

interface NativeText {
  injectionRemoved: string;
  clearConfirmation: string;
  clearAction: string;
  rightClickToSet: string;
  resourceUnreadable: string;
  noSavedSettings: string;
  invalidBackground: string;
  invalidTypography: string;
  folderTitle: string;
  fileTitle: string;
  noRegions: string;
  saved: string;
  loaderUnavailable: string;
  injectionFailed: string;
}

export interface LocalizedText {
  native: NativeText;
  editor: EditorText;
}

export const DEFAULT_LOCALE: ExtensionLocale = 'zh-CN';

const TEXT_BY_LOCALE: Record<ExtensionLocale, LocalizedText> = {
  'zh-CN': {
    native: {
      injectionRemoved: '已移除 Explorer 背景注入，保存的区域配置保持不变。',
      clearConfirmation: '要移除当前工作区中所有已保存的背景与文字水印设置吗？',
      clearAction: '清除全部',
      rightClickToSet: '请在 Explorer 中右键本地文件或文件夹，再设置背景。',
      resourceUnreadable: '无法读取所选 Explorer 资源。',
      noSavedSettings: '此资源没有已保存的背景设置。',
      invalidBackground: '背景颜色、透明度或背景文字无效。',
      invalidTypography: '背景文字样式设置无效。',
      folderTitle: '设置文件夹背景',
      fileTitle: '设置文件背景',
      noRegions: '由于不存在任何颜色区域，已移除 Explorer 背景注入。',
      saved: 'Explorer 背景和文字水印已保存。请在 Custom CSS and JS Loader 提示时重启 VS Code。',
      loaderUnavailable:
        '需要安装“Custom CSS and JS Loader”（be5invis.vscode-custom-css），然后运行“彩色文件夹背景：应用 Explorer 背景颜色”。',
      injectionFailed: '背景设置已保存，但 DOM 注入未生效。',
    },
    editor: {
      title: '设置 Explorer 背景',
      language: '语言',
      folderScope: '所选文件夹及其所有可见后代都会使用此背景效果。',
      fileScope: '只有所选文件会使用此背景效果。',
      backgroundColor: '背景颜色',
      backgroundOpacity: '背景不透明度',
      separator: '：',
      backgroundText: '背景文字',
      watermarkPlaceholder: '例如：前端',
      watermarkHint: '文字优先竖排；如果竖排会过小，则改为两列，按从左到右、从上到下排列。',
      typography: '背景文字样式',
      fontFamily: '字体家族',
      fontPlaceholder: '使用 VS Code 默认字体',
      fontFamilyHint: '可以输入任意已安装的 CSS 字体家族，或选择预设。',
      textColor: '文字颜色',
      textOpacity: '文字不透明度',
      outlineWidth: '描边宽度',
      outlineColor: '描边颜色',
      outlineOpacity: '描边不透明度',
      previewAria: '背景预览',
      previewPlaceholder: 'Explorer 水印预览',
      save: '保存背景',
      cancel: '取消',
      remove: '移除颜色',
    },
  },
  en: {
    native: {
      injectionRemoved: 'Explorer background injection was removed. Saved regions are unchanged.',
      clearConfirmation: 'Remove every saved Explorer background color and watermark for this workspace?',
      clearAction: 'Clear all',
      rightClickToSet: 'Right-click a local file or folder in Explorer to set its background.',
      resourceUnreadable: 'The selected Explorer resource could not be read.',
      noSavedSettings: 'This resource does not have saved background settings.',
      invalidBackground: 'The background color, opacity, or watermark text is invalid.',
      invalidTypography: 'The watermark typography settings are invalid.',
      folderTitle: 'Set Folder Background',
      fileTitle: 'Set File Background',
      noRegions: 'Explorer background injection was removed because no color regions remain.',
      saved: 'Explorer backgrounds and watermarks were saved. Restart VS Code when Custom CSS and JS Loader prompts you.',
      loaderUnavailable:
        'Install Custom CSS and JS Loader (be5invis.vscode-custom-css), then run “Colored Folder Background: Apply Explorer Background Colors”.',
      injectionFailed: 'Explorer background settings were saved, but the DOM injection was not applied.',
    },
    editor: {
      title: 'Set Explorer Background',
      language: 'Language',
      folderScope: 'The selected folder and every visible descendant will receive this background treatment.',
      fileScope: 'Only the selected file will receive this background treatment.',
      backgroundColor: 'Background color',
      backgroundOpacity: 'Background opacity',
      separator: ': ',
      backgroundText: 'Background text',
      watermarkPlaceholder: 'e.g. frontend',
      watermarkHint: 'Characters fill vertically first. If that would become too small, they wrap into two left-to-right columns.',
      typography: 'Background text appearance',
      fontFamily: 'Font family',
      fontPlaceholder: 'VS Code default',
      fontFamilyHint: 'Enter any installed CSS font family, or choose a preset.',
      textColor: 'Text color',
      textOpacity: 'Text opacity',
      outlineWidth: 'Outline width',
      outlineColor: 'Outline color',
      outlineOpacity: 'Outline opacity',
      previewAria: 'Background preview',
      previewPlaceholder: 'Explorer watermark preview',
      save: 'Save background',
      cancel: 'Cancel',
      remove: 'Remove color',
    },
  },
};

export class LocaleStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public get(): ExtensionLocale {
    const stored = this.context.globalState.get<unknown>('coloredFolderBackground.locale');
    return normalizeLocale(stored);
  }

  public async set(value: unknown): Promise<ExtensionLocale> {
    const locale = normalizeLocale(value);
    await this.context.globalState.update('coloredFolderBackground.locale', locale);
    return locale;
  }
}

export function normalizeLocale(value: unknown): ExtensionLocale {
  return value === 'en' ? 'en' : DEFAULT_LOCALE;
}

export function localizedText(locale: ExtensionLocale): LocalizedText {
  const normalized = normalizeLocale(locale);
  return TEXT_BY_LOCALE[normalized];
}

export const EDITOR_TEXT_BY_LOCALE: Record<ExtensionLocale, EditorText> = {
  'zh-CN': TEXT_BY_LOCALE['zh-CN'].editor,
  en: TEXT_BY_LOCALE.en.editor,
};
