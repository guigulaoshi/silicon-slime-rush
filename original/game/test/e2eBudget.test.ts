import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser suite's time budgets, checked without starting a browser.
 *
 * It was: the default budget was ten
 * minutes, so a menu test whose click could never land retried for the full ten and reported one
 * line. turned that round -- 90 seconds by default, and a file that really drives asks for
 * more at the top of itself.
 *
 * Nothing else guards that. Playwright budgets only ever *loosen* a test, so putting the default
 * back to ten minutes leaves every spec passing and the twenty-minute failure comes back the next
 * time something breaks. These three rules run in the ordinary gate, in milliseconds.
 */
const E2E = resolve(process.cwd(), 'e2e');
const CONFIG = readFileSync(resolve(process.cwd(), 'playwright.config.ts'), 'utf-8');
const specs = readdirSync(E2E).filter((f) => f.endsWith('.spec.ts'));
const BASELINE_DIR = resolve(process.cwd(), '..', 'tools', 'baselines', 'goldengate');
// The eight the visual baseline compares against, from baseline.spec.ts's MILESTONES.
const MILESTONE_SHOTS = ['01-start', '02-fort-point', '03-south-tower', '04-bridge-south',
                         '05-bridge-middle', '06-bridge-north', '07-conzelman-hairpins',
                         '08-viewpoint'].map((n) => `${n}.png`);

const budgetOf = (src: string): number | null => {
  const m = /test\.describe\.configure\(\{\s*timeout:\s*([\d_]+)/.exec(src);
  return m ? Number(m[1]!.replace(/_/g, '')) : null;
};

describe('how long a browser test may take', () => {
  it('defaults to a minute and a half, not to ten minutes', () => {
    const m = /^\s*timeout:\s*([\d_ *]+),/m.exec(CONFIG);
    expect(m, 'playwright.config.ts has no default timeout').not.toBeNull();
    // eslint-disable-next-line no-eval
    expect(Number(eval(m![1]!.replace(/_/g, '')))).toBeLessThanOrEqual(90_000);
  });

  it.each(specs)('%s asks for its own budget if it drives', (name) => {
    const src = readFileSync(resolve(E2E, name), 'utf-8');
    const drives = /\?track=|phase === 'racing'/.test(src);
    if (!drives) return;
    expect(budgetOf(src), `${name} loads a world and would die at the 90s default`).not.toBeNull();
  });

  it.each(specs)('%s never waits longer than it is allowed to live', (name) => {
    // A wait longer than the test's own budget can never be the thing that reports: the test dies
    // first, saying only "timeout", which is the one message that names nothing.
    const src = readFileSync(resolve(E2E, name), 'utf-8');
    const budget = budgetOf(src) ?? 90_000;
    for (const m of src.matchAll(/timeout:\s*([\d_]+)/g)) {
      expect(Number(m[1]!.replace(/_/g, '')), `${name}: ${m[0]}`).toBeLessThanOrEqual(budget);
    }
  });
});


describe('the visual baseline directory holds the baseline and nothing else', () => {
  /* */
  it.skipIf(!existsSync(BASELINE_DIR))('contains exactly the eight milestone snapshots', () => {
    const found = readdirSync(BASELINE_DIR).filter((f) => f.endsWith('.png')).sort();
    expect(found).toEqual([...MILESTONE_SHOTS].sort());
  });

  it('is not where an ad-hoc screenshot lands', () => {
    const shot = readFileSync(resolve(E2E, 'shot.spec.ts'), 'utf-8');
    const out = /const OUT = evidencePath\((.*)\);$/m.exec(shot);
    expect(out, 'shot.spec.ts has no OUT directory').not.toBeNull();
    expect(out![1]).toContain("'shots'");
  });
});

/**
 * SwiftShader drew 3D on the CPU (one browser took seven cores), so the suite ran two browsers
 * and still starved; headless Metal with four ran the same 20 tests in 52 s instead of 4 min 47 s. Putting
 * the default back leaves every spec green and the full run slow again, so the default is pinned here --
 * and so is the software opt-in for the pixel baseline, whose images were recorded under SwiftShader.
 */
describe('which renderer the browser suite uses', () => {
  const PACKAGE = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as { scripts: Record<string, string> };
  it('renders on the GPU with four browsers unless software is asked for', () => {
    expect(CONFIG).toMatch(/const GPU = REAL_GPU \|\| process\.env\.SR_E2E_SOFTWARE !== '1';/);
    expect(CONFIG).toMatch(/workers: REAL_GPU \? 1 : GPU \? 4 : 2,/);
    expect(CONFIG).toMatch(/args: \['--mute-audio', \.\.\.\(GPU\s*\?\s*\['--use-gl=angle', '--use-angle=metal'/);
  });
  it('keeps the pixel comparisons on the renderer their images were recorded with', () => {
    expect(PACKAGE.scripts.baseline).toMatch(/^SR_E2E_SOFTWARE=1 /);
    expect(PACKAGE.scripts['baseline:update']).toMatch(/^SR_E2E_SOFTWARE=1 /);
    expect(PACKAGE.scripts['e2e:pixel']).toBe('SR_E2E_SOFTWARE=1 playwright test --grep @pixel --grep-invert @version');
    expect(PACKAGE.scripts['e2e:delivery']).toContain('npm run e2e:pixel');
    expect(PACKAGE.scripts['e2e:delivery:parallel']).toContain('@pixel');
    expect(PACKAGE.scripts['e2e:version']).toContain('--grep-invert @pixel && npm run baseline');
  });
  // A spec comparing pixels against a stored image must say which renderer it belongs to, or a GPU run
  // reports every pixel as changed (slime-overhaul did: 68 % after the switch).
  it.each(specs)('%s tags any stored-image pixel comparison for the software pass', (name) => {
    const src = readFileSync(resolve(E2E, name), 'utf-8');
    if (!/toMatchSnapshot|baselinePath\([^)]*\.png/.test(src)) return;
    expect(/@pixel|process\.env\.SR_E2E_SOFTWARE !== '1'/.test(src), name).toBe(true);
  });
});

it('scales full-route driving time for the requested long highway without changing physics turbo', async () => {
  const { driveBudgetGameSeconds } = await import('../e2e/driveBudget');
  expect(driveBudgetGameSeconds(1000, 1)).toBe(360);
  expect(driveBudgetGameSeconds(68_500, 1)).toBe(6880);
  expect(driveBudgetGameSeconds(1000, 4)).toBe(430);
});
