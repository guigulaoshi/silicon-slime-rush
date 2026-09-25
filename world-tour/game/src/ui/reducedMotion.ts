/** Either the in-game preference or the operating system can request less motion. */
export function reducedMotion():boolean {
 return document.documentElement.dataset.reducedMotion === 'true'
  || (typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false));
}
