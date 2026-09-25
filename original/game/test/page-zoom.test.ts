import { describe, expect, it } from 'vitest';
import { resetPageZoom } from '../src/ui/pageZoom';

// A race that starts zoomed in pins the viewport scale to 1, then restores the page's own tag.
function fakeDoc(content: string) {
  const meta = { content };
  return { meta, doc: { querySelector: () => meta } as unknown as Document };
}

describe('resetPageZoom', () => {
  it('pins the scale range to 1 while zoomed and restores the original tag afterwards', () => {
    const original = 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover';
    const { meta, doc } = fakeDoc(original);
    let restore: (() => void) | null = null;
    expect(resetPageZoom(doc, { scale: 2.5 }, fn => { restore = fn; })).toBe(true);
    expect(meta.content).toBe('width=device-width, initial-scale=1, viewport-fit=cover, minimum-scale=1, maximum-scale=1');
    restore!();
    expect(meta.content).toBe(original);
  });

  it('leaves an unzoomed page and a page without a visual viewport alone', () => {
    const { meta, doc } = fakeDoc('width=device-width');
    expect(resetPageZoom(doc, { scale: 1 }, () => { throw new Error('no restore expected'); })).toBe(false);
    expect(resetPageZoom(doc, null)).toBe(false);
    expect(meta.content).toBe('width=device-width');
  });
});
