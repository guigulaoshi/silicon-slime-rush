import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface ResourceLimits {
  web_total_mb: number;
  shipping_files: number;
  textures_vram_mb: number;
  first_drive_bytes: number;
  garage_assets_bytes: number;
  max_triangles: number;
  max_draw_calls: number;
  max_loaded_tiles: number;
  desktop_min_fps: number;
  desktop_max_p95_ms: number;
  phone_min_fps: number;
  phone_max_p95_ms: number;
  startup_fcp_ms: number;
  slime_emit_ms: number;
  splash_query_ms: number;
  single_file_mb: number;
  path_length_chars: number;
}

export const RESOURCE_LIMITS = JSON.parse(readFileSync(
  resolve(process.cwd(), '..', 'tools', 'resource_limits.json'), 'utf8')) as ResourceLimits;

type LimitKey = keyof ResourceLimits;

function measured(actual: number, key: LimitKey): void {
  if (!Number.isFinite(actual)) throw new Error(`resource limit ${key} received a non-finite measurement`);
}

export function checkMaximum(actual: number, key: LimitKey, label: string): void {
  measured(actual, key);
  const limit = RESOURCE_LIMITS[key];
  if (actual > limit) throw new Error(
    `HARD LIMIT: ${key} ${actual} > ${limit} (${label}); raise the limit only if the platform allows it`);
}

export function checkMinimum(actual: number, key: LimitKey, label: string): void {
  measured(actual, key);
  const limit = RESOURCE_LIMITS[key];
  if (actual < limit) throw new Error(
    `HARD LIMIT: ${key} ${actual} < ${limit} (${label}); raise the limit only if the platform allows it`);
}
