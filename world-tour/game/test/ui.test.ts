import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SAVE, SAVE_VERSION, Save, migrate, type Storage } from '../src/app/Save';
import { I18n, LANGUAGES, detectLanguage } from '../src/ui/i18n';
import { MenuList, applyAction } from '../src/ui/Ui';
import { CATALOGUE, playable } from '../src/app/tracks';
import { CARS, TIMES } from '../src/ui/StartScreen';

class Memory implements Storage {
  map = new Map<string, string>();
  getItem(k: string) { return this.map.get(k) ?? null; }
  setItem(k: string, v: string) { this.map.set(k, v); }
}

describe('i18n', () => {
  it('converts speed before rounding and follows a language change', () => {
    const i = new I18n('en');
    expect(i.speed(100)).toEqual({ value: 62, unit: 'mph' });
    expect(i.speed(1.609344 * 60)).toEqual({ value: 60, unit: 'mph' });
    expect(i.speed(0)).toEqual({ value: 0, unit: 'mph' });
    i.set('zh');
    expect(i.speed(100)).toEqual({ value: 100, unit: 'km/h' });
  });
  it('shows weight in lbs in English and kg in Chinese', () => {
    const i = new I18n('en');
    expect(i.mass(4200)).toEqual({ value: 9259, unit: 'lbs' });
    i.set('zh');
    expect(i.mass(4200)).toEqual({ value: 4200, unit: 'kg' });
  });
  it('has exactly the same keys in every language', () => {
    const [first, ...rest] = LANGUAGES;
    const reference = I18n.keys(first!);
    for (const lang of rest) expect(I18n.keys(lang), `${lang} differs`).toEqual(reference);
    expect(reference.length).toBeGreaterThan(40);
  });

  it('has a name and a blurb for every track in the catalogue', () => {
    const keys = new Set(I18n.keys('zh'));
    for (const t of CATALOGUE) {
      expect(keys.has(`track.${t.id}.name`), `${t.id} name`).toBe(true);
      expect(keys.has(`track.${t.id}.blurb`), `${t.id} blurb`).toBe(true);
    }
  });

  it('has copy for every car and condition the start screen offers', () => {
    // These keys are built from the arrays rather than written out, so TypeScript cannot see a
    // missing one: a car with no 文案 renders the raw key `car.hatch.name` on the button.
    const keys = new Set(I18n.keys('zh'));
    for (const c of CARS) {
      expect(keys.has(`car.${c}.name`), `${c} name`).toBe(true);
      expect(keys.has(`car.${c}.desc`), `${c} desc`).toBe(true);
    }
    for (const t of TIMES) expect(keys.has(`time.${t}`), t).toBe(true);
    for (const density of ['none', 'normal', 'many']) {
      expect(keys.has(`slimeDensity.${density}`), density).toBe(true);
    }
  });

  it('has a name for every town the locator map labels', () => {
    // The ids come from the pipeline (`PLACE_NAMES` in menumap.py) and the labels live here, so a
    // town added there without a name here would draw the raw key `place.san-mateo` on the map.
    const map = JSON.parse(readFileSync(resolve(process.cwd(), 'public', 'menu-map.json'), 'utf-8'));
    const keys = new Set(I18n.keys('zh'));
    expect(map.places.length).toBeGreaterThan(4);
    for (const p of map.places) expect(keys.has(`place.${p.id}`), p.id).toBe(true);
  });

  it('has a label for every quality setting the menu can show', () => {
    const keys = new Set(I18n.keys('zh'));
    for (const q of ['auto', 'high', 'medium', 'low']) {
      expect(keys.has(`settings.quality.${q}`), q).toBe(true);
    }
  });

  it('substitutes placeholders and falls back visibly', () => {
    const i = new I18n('en');
    expect(i.t('menu.best', { time: '1:23.45' })).toBe('Best 1:23.45');
    expect(i.t('nope.missing')).toBe('nope.missing');
    expect(i.t('menu.best')).toContain('{time}');
  });

  it('picks Chinese only for Chinese browsers', () => {
    expect(detectLanguage({ language: 'zh-CN', languages: ['zh-CN'] })).toBe('zh');
    expect(detectLanguage({ language: 'en-US', languages: ['en-US', 'fr'] })).toBe('en');
    expect(detectLanguage({ language: 'fr', languages: ['fr', 'zh-TW'] })).toBe('en');
    expect(detectLanguage({})).toBe('en');
  });
});

describe('Save', () => {
  it('migrates old saves without inventing a day choice and persists either explicit time', () => {
    const store = new Memory();
    store.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({ version: 2, language: 'zh',
      best: { lhasa: 123 }, slimeDensity: 'many' }));
    expect(new Save(store).all).toMatchObject({ version: SAVE_VERSION, timeOfDay: null,
      language: 'zh', best: { 'lhasa@micro-hatch': 123 }, slimeDensity: 'many' });
    for (const timeOfDay of ['night', 'day'] as const) {
      new Save(store).update({ timeOfDay });
      expect(new Save(store).all.timeOfDay).toBe(timeOfDay);
    }
    expect(migrate({ timeOfDay: 'dusk' as never }).timeOfDay).toBeNull();
  });

  it('remembers each track vehicle independently and rejects retired ids on migration', () => {
    const store = new Memory();
    const save = new Save(store);
    save.rememberVehicle('sydney', 'school-bus');
    save.rememberVehicle('lhasa', 'pickup-travel-trailer');
    expect(new Save(store).all.vehicles).toEqual({ sydney: 'school-bus', lhasa: 'pickup-travel-trailer' });
    expect(migrate({ vehicles: { sydney: 'riot-truck', lhasa: 'retro-van' } }).vehicles)
      .toEqual({ lhasa: 'retro-van' });
  });
  it('starts from defaults and keeps settings across instances', () => {
    const store = new Memory();
    const a = new Save(store);
    expect(a.all.volume).toBe(DEFAULT_SAVE.volume);
    // A new player starts on the most slimes; the ghost starts off.
    expect(a.all).toMatchObject({ slimeDensity: 'many', showGhost: false });
    a.update({ language: 'zh', quality: 'low', volume: 0.3, muted: true, slimeDensity: 'normal', showGhost: true });
    const b = new Save(store);
    // A chosen 'normal' survives a reload; so does the ghost switch.
    expect(b.all).toMatchObject({
      language: 'zh', quality: 'low', volume: 0.3, muted: true, slimeDensity: 'normal', showGhost: true,
    });
  });

  it('lets an embedded performance run override this page without changing stored preferences', () => {
    const store = new Memory();
    const save = new Save(store);
    save.update({ quality: 'medium', slimeDensity: 'normal' });
    const before = store.getItem('silicon-rush-world-tour.save.v1');
    save.useForSession({ quality: 'low', slimeDensity: 'many' });
    expect(save.all).toMatchObject({ quality: 'low', slimeDensity: 'many' });
    expect(store.getItem('silicon-rush-world-tour.save.v1')).toBe(before);
  });

  it('records a best time only when it is actually better', () => {
    const s = new Save(new Memory());
    expect(s.best('sydney')).toBeNull();
    expect(s.record('sydney', 300)).toBe(true);
    expect(s.record('sydney', 320)).toBe(false);
    expect(s.best('sydney')).toBe(300);
    expect(s.record('sydney', 290)).toBe(true);
    expect(s.best('sydney')).toBe(290);
  });

  it('survives a corrupt or hostile save rather than half-reading it', () => {
    const store = new Memory();
    store.setItem('silicon-rush-world-tour.save.v1', '{not json');
    expect(new Save(store).all.volume).toBe(DEFAULT_SAVE.volume);
    expect(migrate({ quality: 'ultra' as never, volume: 99, obstacles: 'no' as never,
      best: { a: -1, b: 12 } })).toMatchObject({
      quality: 'auto', volume: DEFAULT_SAVE.volume, slimeDensity: 'many', showGhost: false, best: { 'b@micro-hatch': 12 },
    });
    expect(migrate({ obstacles: false }).slimeDensity).toBe('none');
    expect(migrate({ obstacles: true }).slimeDensity).toBe('normal');
    expect(migrate({ version: 16, showGhost: 'no' as never }).showGhost).toBe(false);
  });

  it('turns the ghost off for saves that only carried the old default, and keeps a choice made since', () => {
    expect(migrate({ version: 15, showGhost: true }).showGhost).toBe(false);
    expect(migrate({ showGhost: true }).showGhost).toBe(false);
    expect(migrate({ version: 16, showGhost: true }).showGhost).toBe(true);
    expect(migrate({ version: 16, showGhost: false }).showGhost).toBe(false);
  });

  it('gives only a save with no tier the new most-slimes default', () => {
    expect(migrate({ version: 12, best: { a: 1 } }).slimeDensity).toBe('many');
    for (const tier of ['none', 'normal', 'many'] as const) expect(migrate({ version: 12, slimeDensity: tier }).slimeDensity).toBe(tier);
  });

  it('migrates and persists music and effects without changing old master or mute', () => {
    const old = migrate({ version: 4, volume: 0.3, muted: true });
    expect(old).toMatchObject({ volume: 0.3, muted: true, musicVolume: 0.5, effectsVolume: 1 });
    expect(migrate({ musicVolume: NaN, effectsVolume: 99 })).toMatchObject({ musicVolume: 0.5, effectsVolume: 1 });
    const store = new Memory();
    new Save(store).update({ musicVolume: 0.25, effectsVolume: 0, muted: true });
    expect(new Save(store).all).toMatchObject({ musicVolume: 0.25, effectsVolume: 0, muted: true });
  });

  it('works with no storage at all', () => {
    const s = new Save(null);
    expect(s.record('x', 10)).toBe(true);
    expect(s.best('x')).toBe(10);
  });
});

describe('MenuList', () => {
  const items = () => [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B', disabled: true },
    { id: 'c', label: 'C' },
  ];

  it('skips locked entries when moving', () => {
    const list = new MenuList(items());
    expect(list.current?.id).toBe('a');
    list.move(1);
    expect(list.current?.id).toBe('c');
    list.move(1);
    expect(list.current?.id).toBe('a');
    list.move(-1);
    expect(list.current?.id).toBe('c');
  });

  it('starts on the first entry that can be chosen', () => {
    const list = new MenuList([{ id: 'x', label: 'X', disabled: true }, { id: 'y', label: 'Y' }]);
    expect(list.current?.id).toBe('y');
  });

  it('keeps the selection when the list is rebuilt', () => {
    const list = new MenuList(items());
    list.move(1);
    list.setItems(items());
    expect(list.current?.id).toBe('c');
  });

  it('turns actions into outcomes', () => {
    const list = new MenuList(items());
    expect(applyAction(list, 'down')).toBe('moved');
    expect(applyAction(list, 'confirm')).toBe('confirm');
    expect(applyAction(list, 'back')).toBe('back');
    const locked = new MenuList([{ id: 'z', label: 'Z', disabled: true }]);
    expect(applyAction(locked, 'confirm')).toBeNull();
  });
});

describe('catalogue', () => {
  it('lists every track and only lets the built ones be driven', () => {
    // we retired the scenic/campus split, so no kind or kind order is asserted.
    expect(CATALOGUE.length).toBeGreaterThanOrEqual(4);
    expect(playable('sydney', false)).toBe(true);
    // Every track in the current CATALOGUE ships built, so there is no
    // real "listed but not built yet" id any more; this checks an id that is not in the catalogue at all.
    expect(playable('not-a-real-track', false)).toBe(false);
    expect(playable('synth-loop', false)).toBe(false);
    expect(playable('synth-loop', true)).toBe(true);
  });
});
