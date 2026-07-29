export interface WatermarkStyle {
  fontFamily: string;
  fontColor: string;
  fontOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
}

export interface ColorRegion {
  uri: string;
  fsPath: string;
  color: string;
  opacity: number;
  recursive: boolean;
  watermark: string;
  watermarkStyle: WatermarkStyle;
}

export function normalizeHexColor(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const color = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toUpperCase() : undefined;
}

export function normalizeOpacity(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

export function normalizeWatermarkText(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const watermark = value.replace(/\s+/g, ' ').trim();
  return Array.from(watermark).length <= 48 ? watermark : undefined;
}

export function normalizeFontFamily(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const fontFamily = value.trim();
  if (fontFamily.length > 160 || /[\u0000-\u001F\u007F;{}<>]/.test(fontFamily)) {
    return undefined;
  }

  return fontFamily;
}

export function normalizeStrokeWidth(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 6) {
    return undefined;
  }

  return Math.round(value * 100) / 100;
}

export function defaultWatermarkStyle(
  fallbackColor: string,
  backgroundOpacity: number,
): WatermarkStyle {
  const fontColor = normalizeHexColor(fallbackColor) ?? '#3B82F6';
  const opacity = normalizeOpacity(backgroundOpacity) ?? 0.28;
  const fontOpacity = Math.round(Math.max(0.24, Math.min(0.64, opacity + 0.18)) * 100) / 100;

  return {
    fontFamily: '',
    fontColor,
    fontOpacity,
    strokeColor: '#000000',
    strokeOpacity: 0.42,
    strokeWidth: 0,
  };
}

export function normalizeWatermarkStyle(
  value: unknown,
  fallbackColor: string,
  backgroundOpacity: number,
): WatermarkStyle {
  const defaults = defaultWatermarkStyle(fallbackColor, backgroundOpacity);
  if (!value || typeof value !== 'object') {
    return defaults;
  }

  const candidate = value as Record<string, unknown>;
  const fontFamily = normalizeFontFamily(candidate.fontFamily);
  const fontColor = normalizeHexColor(candidate.fontColor);
  const fontOpacity = normalizeOpacity(candidate.fontOpacity);
  const strokeColor = normalizeHexColor(candidate.strokeColor);
  const strokeOpacity = normalizeOpacity(candidate.strokeOpacity);
  const strokeWidth = normalizeStrokeWidth(candidate.strokeWidth);

  return {
    fontFamily: fontFamily ?? defaults.fontFamily,
    fontColor: fontColor ?? defaults.fontColor,
    fontOpacity: fontOpacity ?? defaults.fontOpacity,
    strokeColor: strokeColor ?? defaults.strokeColor,
    strokeOpacity: strokeOpacity ?? defaults.strokeOpacity,
    strokeWidth: strokeWidth ?? defaults.strokeWidth,
  };
}

export function parseColorRegion(value: unknown): ColorRegion | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const candidate = value as Record<string, unknown>;
  const uri = candidate.uri;
  const fsPath = candidate.fsPath;
  const color = normalizeHexColor(candidate.color);
  const opacity = normalizeOpacity(candidate.opacity);
  const watermark =
    candidate.watermark === undefined ? '' : normalizeWatermarkText(candidate.watermark);
  const recursive = candidate.recursive;

  if (
    typeof uri !== 'string' ||
    typeof fsPath !== 'string' ||
    !color ||
    opacity === undefined ||
    watermark === undefined ||
    typeof recursive !== 'boolean'
  ) {
    return undefined;
  }

  const watermarkStyle = normalizeWatermarkStyle(candidate.watermarkStyle, color, opacity);
  return { uri, fsPath, color, opacity, watermark, watermarkStyle, recursive };
}
