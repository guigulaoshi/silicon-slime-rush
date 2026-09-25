import { afterEach, expect, it } from 'vitest';
import { resolve } from 'node:path';
import { buildCredits, UNCOMMITTED } from '../build/credits';

/* */
const root = resolve(__dirname, '../..');
const dirtyTree = () => ' M game/src/main.ts\n';

afterEach(() => { delete process.env.SR_RELEASE; });

it('refuses a release build from a tree with uncommitted changes', () => {
  process.env.SR_RELEASE = '1';
  expect(() => buildCredits(root, dirtyTree)).toThrow(/uncommitted changes/);
});

it('says so in credits.txt when an ordinary build comes from such a tree', () => {
  const { metadata, notices } = buildCredits(root, dirtyTree);
  expect(metadata.dirty).toBe(true);
  expect(notices.split('\n')[1]).toBe(`Version ${metadata.version} ${UNCOMMITTED}`);
});

it('reads a clean tree as clean', () => {
  process.env.SR_RELEASE = '1';
  const { metadata, notices } = buildCredits(root, () => '');
  expect(metadata.dirty).toBe(false);
  expect(notices.split('\n')[1]).toBe(`Version ${metadata.version}`);
});
