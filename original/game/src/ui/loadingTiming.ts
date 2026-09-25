/** 90 ms to settle the fill, then roughly 120 ms resting at 100%. */
export const LOADING_COMPLETE_HOLD_MS = 210;

export function holdCompletedLoading(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, LOADING_COMPLETE_HOLD_MS));
}
