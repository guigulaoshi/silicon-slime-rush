import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, test } from '@playwright/test';
import { evidencePath } from './evidence';

test.skip(process.env.EVIDENCE_OUTPUT_QA !== '1', 'output-boundary proof');

test('routes a targeted capture according to the explicit evidence switch', () => {
  const output = evidencePath('evidence-output', 'mode.json');
  const evidence = process.env.SR_EVIDENCE === '1';
  expect(output).toContain(evidence ? '/tools/baselines/' : '/game/test-results/evidence/');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, JSON.stringify({
    mode: evidence ? 'tracked-review-evidence' : 'disposable-test-result',
    path: evidence ? 'tools/baselines/evidence-output/mode.json'
      : 'game/test-results/evidence/evidence-output/mode.json',
  }, null, 2) + '\n');
});

test('keeps Playwright cleanup and implicit snapshot creation outside review evidence', ({}, testInfo) => {
  expect(testInfo.project.outputDir).toContain('/game/test-results/playwright');
  expect(testInfo.config.updateSnapshots).toBe('none');
});
