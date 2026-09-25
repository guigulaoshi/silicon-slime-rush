import { evidencePathOr } from './evidence';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, expect, test } from '@playwright/test';
import { PORT } from './server';
import { checkMinimum } from '../test-support/resource-limit';

// One eight-second real-device sample per vehicle, plus Android navigation and track loading.
test.describe.configure({ timeout: 240_000 });
test.skip(!process.env.PHONE_DEVICE, 'requires an attached Android test phone');
test('all vehicle models report low-quality phone frame rate', async () => {
  const adb = (...args: string[]) => execFileSync('adb', ['-s', process.env.PHONE_DEVICE!, ...args], { encoding: 'utf8' });
  const orientation = adb('shell', 'settings', 'get', 'system', 'user_rotation').trim();
  const automatic = adb('shell', 'settings', 'get', 'system', 'accelerometer_rotation').trim();
  const forwarded = 9294;
  const previousForward = adb('forward', '--list'); const previousReverse = adb('reverse', '--list');
  expect(previousForward).not.toContain(`tcp:${forwarded}`);
  expect(previousReverse).not.toContain(`tcp:${PORT}`);
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | undefined;
  let page: import('@playwright/test').Page | undefined;
  try {
    adb('reverse', `tcp:${PORT}`, `tcp:${PORT}`);
    adb('forward', `tcp:${forwarded}`, 'localabstract:chrome_devtools_remote');
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0');
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1');
    adb('shell', 'am', 'start', '-n', 'com.android.chrome/com.google.android.apps.chrome.Main');
    browser = await chromium.connectOverCDP(`http://localhost:${forwarded}`);
    page = await browser.contexts()[0]!.newPage();
    const { vehicles } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8'));
    const out = evidencePathOr(process.env.PHONE_OUTPUT, 'curves'); mkdirSync(out, { recursive: true });
    const samples: unknown[] = [];
    // Default track retargeted from shoreline (deleted, "an open flat campus route"): lhasa is
    // the closest replacement, a flat day boulevard through a high valley.
    for (const { id } of vehicles) {
      await page.goto(`http://localhost:${PORT}/?phonecheck=189&track=${process.env.PHONE_TRACK ?? 'lhasa'}&bot=1&dev=1&vehicle=${id}&time=${process.env.PHONE_TIME ?? 'day'}&perf=1&perfQuality=low&perfSlimes=${process.env.PHONE_DENSITY ?? 'normal'}`);
      await expect(page.locator('#perf-readout')).toHaveAttribute('data-complete', 'true', { timeout: 45000 });
      const sample = await page.evaluate(() => {
        const world = (window.game as any).session.world;
        const gl = world.renderer.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
        return { report: window.game.report(), text: document.querySelector('#perf-readout')!.textContent,
          width: innerWidth, height: innerHeight, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER) };
      });
      const fps = Number(sample.text!.match(/([\d.]+) FPS/)![1]);
      checkMinimum(fps, 'phone_min_fps', `${id} low-quality phone frame rate`);
      expect(sample.report.renderQuality).toBe('low');
      expect(sample.width).toBeGreaterThan(sample.height);
      expect(sample.report.resets).toBe(0);
      samples.push({ id, fps, ...sample });
      await page.screenshot({ path: resolve(out, `phone-${id}.png`) });
    }
    writeFileSync(resolve(out, 'phone.json'), JSON.stringify({ device: adb('shell', 'getprop', 'ro.product.model').trim(), samples }, null, 2));
  } finally {
    await page?.close(); await browser?.close();
    adb('shell', 'settings', 'put', 'system', 'user_rotation', orientation);
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', automatic);
    adb('forward', '--remove', `tcp:${forwarded}`); adb('reverse', '--remove', `tcp:${PORT}`);
  }
});
