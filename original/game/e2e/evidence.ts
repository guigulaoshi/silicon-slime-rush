import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const GAME_ROOT = process.cwd();
const BASELINE_ROOT = resolve(GAME_ROOT, '..', 'tools', 'baselines');
const RUN_ROOT = resolve(GAME_ROOT, 'test-results', 'evidence');
mkdirSync(RUN_ROOT, { recursive: true });

/**
 * Ordinary browser runs keep disposable captures under Playwright's ignored output tree. A person
 * must opt into changing review evidence; reading snapshots remains independent of this switch.
 */
export function evidencePath(...parts: string[]): string {
  return resolve(process.env.SR_EVIDENCE === '1' ? BASELINE_ROOT : RUN_ROOT, ...parts);
}

/** Reference data is always read from the reviewed baseline, never from disposable output. */
export function baselinePath(...parts: string[]): string {
  return resolve(BASELINE_ROOT, ...parts);
}

/** Existing one-off output overrides are already an explicit destination choice. */
export function evidencePathOr(override: string | undefined, ...parts: string[]): string {
  return override ? resolve(GAME_ROOT, '..', override) : evidencePath(...parts);
}
