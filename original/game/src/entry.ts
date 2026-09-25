import { holdCompletedLoading } from './ui/loadingTiming';

// Keep the game behind an actual import boundary so the styled HTML can paint first.
let supported = false;
try {
  const probe = document.createElement('canvas').getContext('webgl2');
  supported = !!probe;
  probe?.getExtension('WEBGL_lose_context')?.loseContext();
} catch { /* A graphics failure keeps the lightweight recovery page usable. */ }
if (!supported) window.startup?.fail('graphics');
else {
  window.addEventListener('vite:preloadError', () => window.startup?.fail('network'), { once: true });
  import('./main').then(async ({ ready }) => {
    /* */
    await ready;
    if (window.startup?.complete()) await holdCompletedLoading();
    window.startup?.done();
  }).catch((error: unknown) => {
    console.error(error);
    window.startup?.fail(navigator.onLine ? 'startup' : 'network');
  });
}
