import * as vscode from 'vscode';
import {
  ColorRegion,
  normalizeHexColor,
  normalizeOpacity,
  normalizeWatermarkStyle,
  normalizeWatermarkText,
  parseColorRegion,
  WatermarkStyle,
} from './types';

const STATE_KEY = 'coloredFolderBackground.regions.v1';

export class RegionStore {
  public constructor(private readonly context: vscode.ExtensionContext) {}

  public list(): ColorRegion[] {
    const stored = this.context.workspaceState.get<unknown>(STATE_KEY);
    if (!Array.isArray(stored)) {
      return [];
    }

    const regions: ColorRegion[] = [];
    for (const value of stored) {
      const region = parseColorRegion(value);
      if (region) {
        regions.push(region);
      }
    }

    return regions;
  }

  public get(resource: vscode.Uri): ColorRegion | undefined {
    const key = resource.toString();
    return this.list().find(region => region.uri === key);
  }

  public async upsert(
    resource: vscode.Uri,
    color: string,
    opacity: number,
    watermark: string,
    watermarkStyle: WatermarkStyle,
    recursive: boolean,
  ): Promise<ColorRegion> {
    const normalizedColor = normalizeHexColor(color);
    const normalizedOpacity = normalizeOpacity(opacity);
    const normalizedWatermark = normalizeWatermarkText(watermark);

    if (!normalizedColor || normalizedOpacity === undefined || normalizedWatermark === undefined) {
      throw new Error('Invalid background color, opacity, or watermark text.');
    }

    const normalizedWatermarkStyle = normalizeWatermarkStyle(
      watermarkStyle,
      normalizedColor,
      normalizedOpacity,
    );

    const region: ColorRegion = {
      uri: resource.toString(),
      fsPath: resource.fsPath,
      color: normalizedColor,
      opacity: normalizedOpacity,
      watermark: normalizedWatermark,
      watermarkStyle: normalizedWatermarkStyle,
      recursive,
    };

    const next = this.list().filter(existing => existing.uri !== region.uri);
    next.push(region);
    await this.context.workspaceState.update(STATE_KEY, next);
    return region;
  }

  public async remove(resource: vscode.Uri): Promise<boolean> {
    const regions = this.list();
    const next = regions.filter(region => region.uri !== resource.toString());

    if (next.length === regions.length) {
      return false;
    }

    await this.context.workspaceState.update(STATE_KEY, next);
    return true;
  }

  public async clear(): Promise<void> {
    await this.context.workspaceState.update(STATE_KEY, undefined);
  }
}
