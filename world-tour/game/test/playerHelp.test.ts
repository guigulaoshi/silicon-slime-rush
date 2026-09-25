import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { PlayerHelp } from '../src/ui/PlayerHelp';
import { I18n, detectLanguage } from '../src/ui/i18n';
import { migrate } from '../src/app/Save';
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

it('uses only the primary browser language and migrates optional player preferences', () => {
  expect(detectLanguage({ languages: ['en-US', 'zh-CN'] })).toBe('en');
  expect(detectLanguage({ languages: ['zh-TW', 'en'] })).toBe('zh');
  expect(detectLanguage({ language: 'de' })).toBe('en');
  expect(migrate({ reducedMotion: true, helpDismissed: true })).toMatchObject({ reducedMotion: true, helpDismissed: true });
  expect(migrate({})).toMatchObject({ reducedMotion: false, helpDismissed: false,
    cameraModes: ['chase', 'chase'] });
  expect(migrate({}).touchGuideRaces).toBe(0);
  expect(migrate({ touchGuideRaces: 2 }).touchGuideRaces).toBe(2);
  expect(migrate({ touchGuideRaces: -4 }).touchGuideRaces).toBe(0);
  expect(migrate({ touchGuideRaces: 'many' as never }).touchGuideRaces).toBe(0);
  expect(migrate({ cameraModes: ['hood', 'bad'] as never })).toMatchObject({
    cameraModes: ['hood', 'chase'],
  });
});
it('shows current-language device and player controls, with a dismissible first-drive hint', () => {
  const t = new I18n('en'), dismiss = vi.fn();
  const help = new PlayerHelp(t, vi.fn(), dismiss);
  help.render('intro', true, false, false);
  expect(help.tip.textContent).toContain('WASD'); expect(help.tip.textContent).toContain('/ rescue');
  help.tip.querySelector('button')!.click(); expect(dismiss).toHaveBeenCalledOnce();
  help.render('intro', true, false, true); expect(help.tip.hidden).toBe(true);
  // A phone gets the drawn stick and the countdown hint instead of this line of text.
  t.set('zh'); help.render('intro', false, true, false);
  expect(help.tip.hidden).toBe(true);
});
it('floats nothing over the race: the whole toolbar hides while driving and returns on pause', () => {
  const help = new PlayerHelp(new I18n('zh'), vi.fn(), vi.fn());
  for (const phase of ['countdown', 'racing']) {
    help.render(phase, false, false, false);
    expect(help.node.hidden, phase).toBe(true);
  }
  for (const phase of ['menu', 'intro', 'paused', 'results', 'settings']) {
    help.render(phase, false, false, false);
    expect(help.node.hidden, phase).toBe(false);
    expect(help.node.querySelector('button')!.hidden, phase).toBe(false);
  }
});
