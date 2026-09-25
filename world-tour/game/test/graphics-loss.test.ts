import { expect, it } from 'vitest';
import { GRAPHICS_RESTORE_SECONDS, GraphicsLossNotice } from '../src/ui/GraphicsLoss';
import { I18n } from '../src/ui/i18n';

it('says it is recovering, then how to fix it, and hides again once 3D comes back', () => {
  const timers: { fn: () => void; ms: number }[] = [];
  const notice = new GraphicsLossNotice(new I18n('zh'), ((fn: () => void, ms: number) => (timers.push({ fn, ms }), timers.length)) as any, (() => {}) as any);
  const first = document.createElement('canvas'), second = document.createElement('canvas');
  notice.watch(first);
  expect(notice.node.hidden).toBe(true);
  first.dispatchEvent(new Event('webglcontextlost'));
  expect(notice.node.hidden).toBe(false);
  expect(notice.node.textContent).toContain('正在恢复');
  expect((notice.node.querySelector('button') as HTMLButtonElement).hidden).toBe(true);
  expect(timers.at(-1)!.ms).toBe(GRAPHICS_RESTORE_SECONDS * 1000);
  timers.at(-1)!.fn();
  expect(notice.node.textContent).toContain('彻底关闭浏览器');
  expect((notice.node.querySelector('button') as HTMLButtonElement).hidden).toBe(false);
  first.dispatchEvent(new Event('webglcontextrestored'));
  expect(notice.node.hidden).toBe(true);
  // A replaced renderer moves the watch: the old canvas no longer shows anything, the new one does.
  notice.watch(second);
  first.dispatchEvent(new Event('webglcontextlost'));
  expect(notice.node.hidden).toBe(true);
  second.dispatchEvent(new Event('webglcontextlost'));
  expect(notice.node.hidden).toBe(false);
  notice.dispose();
});
