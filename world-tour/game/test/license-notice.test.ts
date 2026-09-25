import { expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { licenseNotice } from '../build/credits';

it.each(['LICENSE', 'LICENSE.md', 'license', 'License.txt'])('reads the installed %s notice using its exact spelling', name => {
  const dir = mkdtempSync(join(tmpdir(), 'license-notice-'));
  try {
    writeFileSync(join(dir, name), 'Package license text');
    expect(licenseNotice(dir)).toBe('Package license text');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it('reports the package directory when its license is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'license-notice-'));
  try { expect(() => licenseNotice(dir)).toThrow(`Missing license notice in ${dir}`); }
  finally { rmSync(dir, { recursive: true, force: true }); }
});
