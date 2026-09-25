import { expect, it, vi } from 'vitest';
import { home } from '../src/ui/Home';
import { I18n } from '../src/ui/i18n';
import { Screens } from '../src/ui/Ui';

it('focuses the visible home action on opening and returning from settings', async () => {
  const root = document.createElement('div'); document.body.replaceChildren(root);
  const screens = new Screens(root, new I18n('en'));
  const menu = document.createElement('div'); menu.dataset.home = 'true';
  menu.innerHTML = '<section inert><button class="sm-go">Car</button></section><button class="home-go">Road</button>';
  screens.register('menu', menu); screens.register('settings', document.createElement('div'));
  screens.show('menu'); await Promise.resolve();
  expect(document.activeElement).toBe(menu.querySelector('.home-go'));
  screens.show('settings'); await Promise.resolve();
  screens.show('menu'); await Promise.resolve();
  expect(document.activeElement).toBe(menu.querySelector('.home-go'));
});

it.each([0, 1])('keeps slogan %i while translating and never waits for its image to enter', variant => {
  const i18n = new I18n('en'), enter = vi.fn(), language = vi.fn();
  const screen = home(i18n, enter, language, vi.fn(), vi.fn(), variant);
  document.body.replaceChildren(screen.node);
  expect(screen.node.querySelector('.home-slogan')!.textContent).toBe(i18n.t(`home.slogan.${variant}`));
  screen.node.querySelector('img')!.dispatchEvent(new Event('error'));
  screen.go.click(); expect(enter).toHaveBeenCalledOnce();
  (screen.node.querySelector('.home-language') as HTMLButtonElement).click();
  expect(language).toHaveBeenCalledOnce();
  i18n.set('zh'); screen.render(); screen.render();
  expect(screen.node.querySelector('.home-slogan')!.textContent).toBe(i18n.t(`home.slogan.${variant}`));
  expect(screen.node.querySelector('.home-story')!.textContent).toContain('十三座名城');
});
