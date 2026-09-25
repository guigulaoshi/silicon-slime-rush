/**
 * How much of a model has arrived. `total` is null when the response does not say how big the file is
 * -- no Content-Length, or a compressed body whose length counts other bytes -- and a reader then shows
 * that it is working without claiming a fraction.
 */
export interface ModelProgress { loaded: number; total: number | null }
export type ModelProgressListener = (progress: ModelProgress) => void;

/** Only the fixed vehicle catalogue uses this cache; disposable scene objects are never shared. */
interface Entry {
  controller: AbortController;
  promise: Promise<ArrayBuffer>;
  users: number;
  settled: boolean;
  progress: ModelProgress;
  listeners: Set<ModelProgressListener>;
}
const entries = new Map<string, Entry>();
const cancelled = () => new DOMException('Vehicle load cancelled', 'AbortError');

/** Content-Length counts the bytes a reader will see only when the body is not content-encoded. */
function declaredLength(response: Response): number | null {
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') return null;
  const length = Number(response.headers.get('content-length'));
  return Number.isFinite(length) && length > 0 ? length : null;
}

/** Read the body chunk by chunk so every waiting preview can show how far the download is. */
async function readBody(response: Response, entry: Entry): Promise<ArrayBuffer> {
  const total = declaredLength(response);
  const report = (loaded: number, known: number | null) => {
    entry.progress = { loaded, total: known !== null && loaded <= known ? known : null };
    entry.listeners.forEach(listener => listener(entry.progress));
  };
  const reader = response.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  report(0, total);
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    report(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  report(loaded, loaded);
  return bytes.buffer;
}

export async function modelBytes(url: string, signal?: AbortSignal,
  onProgress?: ModelProgressListener): Promise<ArrayBuffer> {
  if (signal?.aborted) throw cancelled();
  let entry = entries.get(url);
  if (!entry) {
    const controller = new AbortController();
    const created: Entry = { controller, users: 0, settled: false, promise: undefined as unknown as Promise<ArrayBuffer>,
      progress: { loaded: 0, total: null }, listeners: new Set() };
    created.promise = fetch(url, { signal: controller.signal }).then(response => {
      if (!response.ok) throw new Error(`${url}: model HTTP ${response.status}`);
      return readBody(response, created);
    }).then(bytes => { created.settled = true; created.listeners.clear(); return bytes; }).catch(error => {
      if (entries.get(url) === created) entries.delete(url);
      throw error;
    });
    entries.set(url, created); entry = created;
  }
  const current = entry;
  current.users++;
  let onAbort: (() => void) | undefined;
  if (onProgress) {
    // A second preview joining a download already under way starts from what has arrived so far.
    if (!current.settled) current.listeners.add(onProgress);
    onProgress(current.progress);
  }
  try {
    const abort = new Promise<never>((_, reject) => {
      onAbort = () => reject(cancelled());
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    const bytes = await Promise.race([current.promise, abort]);
    if (signal?.aborted) throw cancelled();
    return bytes.slice(0);
  } finally {
    if (onProgress) current.listeners.delete(onProgress);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    current.users--;
    if (current.users === 0 && !current.settled) {
      current.controller.abort();
      if (entries.get(url) === current) entries.delete(url);
    }
  }
}

/** A corrected asset must be fetchable after a parse or model-contract failure. */
export function discardModelBytes(url: string): void {
  if (entries.get(url)?.settled) entries.delete(url);
}
