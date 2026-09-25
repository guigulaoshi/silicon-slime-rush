/**
 * The net under `tools/assets.py`: when the data on disk does not match the game asking for it,
 * the screen has to say so.
 *
 * On it did not. A car hung in a blue sky with a working HUD, a working clock and a
 * working minimap, and every fallback behaved impeccably on the way there -- the streamer retried
 * and gave up, the material library kept the greybox palette, and neither said a word. So the
 * tests that matter here are the ones about *when* the sentence appears: too eager and it flashes
 * across a healthy boot, too shy and it is the blue sky again.
 */
import { describe, expect, it } from 'vitest';
import { devHint, staleAssetsKey, type WorldHealth } from '../src/app/dataHealth';
import { I18n } from '../src/ui/i18n';
import { hudScreen, type HudState } from '../src/ui/screens';

const healthy: WorldHealth = { tilesFailed: 0, tilesLoaded: 40, texturesApplied: 12 };

describe('staleAssetsKey', () => {
  it('says nothing about a tree whose data is fine', () => {
    expect(staleAssetsKey(healthy)).toBeNull();
  });

  it('says nothing while the textures are still loading', () => {
    // The whole boot passes through this state: tiles are up, the manifest is in flight. Reporting
    // here would put「贴图没跟上」on screen every single time the game starts.
    expect(staleAssetsKey({ ...healthy, texturesApplied: null })).toBeNull();
  });

  it('names the greybox once the texture load has settled on nothing', () => {
    expect(staleAssetsKey({ ...healthy, texturesApplied: 0 })).toBe('hud.staleTextures');
  });

  it('does not call one dead tile a broken tree', () => {
    // `tilesFailed` is already post-retry, so one is a tile that really is gone -- a hole the car
    // drives past. A banner that never leaves is the wrong answer to it.
    expect(staleAssetsKey({ ...healthy, tilesFailed: 1 })).toBeNull();
    expect(staleAssetsKey({ ...healthy, tilesFailed: 2 })).toBeNull();
  });

  it('reports the tiles once three separate ones have been given up on', () => {
    expect(staleAssetsKey({ ...healthy, tilesFailed: 3 })).toBe('hud.staleTiles');
  });

  it('reports the tiles before the textures when both are behind', () => {
    // This is the shape exactly: nothing loaded at all. The tiles are the sentence
    // worth reading -- a greybox road is still a road.
    const dead: WorldHealth = { tilesFailed: 12, tilesLoaded: 0, texturesApplied: 0 };
    expect(staleAssetsKey(dead)).toBe('hud.staleTiles');
  });

  it('says nothing before any tile has loaded and none has failed', () => {
    expect(staleAssetsKey({ tilesFailed: 0, tilesLoaded: 0, texturesApplied: null })).toBeNull();
  });
});

describe('the sentence itself', () => {
  it('reads as a player sentence, and a development build adds the command to run', () => {
    // The uploaded build carries no development details, so the command is a development-only
    // suffix (`devHint`) rather than part of the sentence players read.
    for (const lang of ['zh', 'en'] as const) {
      const i18n = new I18n(lang);
      for (const key of ['hud.staleTiles', 'hud.staleTextures']) {
        const text = i18n.t(key);
        expect(text, `${lang} ${key}`).not.toBe(key);
        expect(text, `${lang} ${key}`).not.toContain('assets.py');
        expect(devHint(text, 'assets'), `${lang} ${key}`).toContain('tools/assets.py');
      }
    }
  });

  it('reaches the HUD in a slot of its own, where nothing else can cover it', () => {
    const i18n = new I18n('zh');
    const state: HudState = {
      score: 0, slimeHits: 0,
      scoreAwards: [], reducedMotion: false,
      time: 0, speedKmh: 0, checkpoint: 1, checkpoints: 4, lap: 1, laps: 1,
      wrongWay: true, notice: '', alert: devHint(i18n.t('hud.staleTiles'), 'assets'), countdown: '', device: 'keyboard',
      route: null, view: { x: 0, z: 0, headingX: 0, headingZ: 1, s: 0 },
    };
    const hud = hudScreen(i18n, () => state, () => {});
    hud.render();
    /* */
    expect(hud.node.querySelector('.hud-alert')?.textContent).toContain('tools/assets.py');
    expect(hud.node.querySelector('.hud-notice')?.textContent).toBe(i18n.t('hud.wrongWay'));
  });
});
