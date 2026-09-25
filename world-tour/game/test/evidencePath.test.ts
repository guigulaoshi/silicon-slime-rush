import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { baselinePath, evidencePath, evidencePathOr } from '../e2e/evidence';

describe.sequential('Playwright evidence output', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('keeps an ordinary capture under the ignored Playwright results tree', () => {
    vi.stubEnv('SR_EVIDENCE', '');
    expect(evidencePath('route', 'frame.png'))
      .toBe(resolve('test-results/evidence/route/frame.png'));
  });

  it('writes the same capture to the tracked review tree only when explicitly requested', () => {
    vi.stubEnv('SR_EVIDENCE', '1');
    expect(evidencePath('route', 'frame.png'))
      .toBe(resolve('../tools/baselines/route/frame.png'));
  });

  it('always reads reviewed reference data from the tracked baseline tree', () => {
    vi.stubEnv('SR_EVIDENCE', '');
    expect(baselinePath('curves', 'before.json'))
      .toBe(resolve('../tools/baselines/curves/before.json'));
  });

  it('preserves an explicit one-off output override', () => {
    vi.stubEnv('SR_EVIDENCE', '');
    expect(evidencePathOr('tmp/custom-proof', 'unused'))
      .toBe(resolve('../tmp/custom-proof'));
  });

  it('keeps every routine test writer behind the shared output boundary', () => {
    const direct = ['e2e', 'test'].flatMap(directory => readdirSync(directory)
      .filter((name) => name.endsWith('.ts'))
      .filter((name) => !['baseline.spec.ts', 'evidence-output.spec.ts', 'evidence.ts',
        'evidencePath.test.ts', 'e2eBudget.test.ts'].includes(name))
      .flatMap((name) => {
        const source = readFileSync(resolve(directory, name), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/\/\/.*$/gm, '');
        const writesFiles = /\bwriteFile(?:Sync)?\b|\.screenshot\s*\(/.test(source);
        const namesBaseline = /tools\/baselines|['"]baselines['"]/.test(source);
        return writesFiles && namesBaseline ? [`${directory}/${name}`] : [];
      }));
    expect(direct).toEqual([]);
  });
});
