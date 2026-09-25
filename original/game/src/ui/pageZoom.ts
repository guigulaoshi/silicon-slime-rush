/**
 * The menus refuse pinch zoom (index.html and game.css), but a browser that ignores both --
 * Safari with an accessibility zoom, Chrome with "force enable zoom" -- can still arrive at a race
 * zoomed in, and the race canvas blocks the pinch that would undo it. Briefly pinning the viewport's
 * scale range to 1 is the one page-side lever that snaps the visual viewport back.
 */
export function resetPageZoom(
  doc: Document | undefined = globalThis.document,
  view: Pick<VisualViewport, 'scale'> | null | undefined = globalThis.visualViewport,
  later: (restore: () => void) => void = restore => setTimeout(restore, 400),
): boolean {
  if (!doc || !view || view.scale <= 1.001) return false;
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return false;
  const original = meta.content;
  const pinned = original.split(',').map(part => part.trim())
    .filter(part => part && !/^(minimum|maximum)-scale\s*=/.test(part) && !/^user-scalable\s*=/.test(part));
  meta.content = [...pinned, 'minimum-scale=1', 'maximum-scale=1'].join(', ');
  later(() => { meta.content = original; });
  return true;
}
