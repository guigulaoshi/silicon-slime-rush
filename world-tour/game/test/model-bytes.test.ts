import { afterEach, expect, it, vi } from 'vitest';
import { modelBytes, discardModelBytes } from '../src/vehicles/modelBytes';

afterEach(() => vi.unstubAllGlobals());
it('coalesces requests, isolates buffers, and one cancelled preview does not cancel another car', async () => {
  let finish!: (value: Response) => void; let upstream!: AbortSignal;
  const fetcher = vi.fn((_url, options) => { upstream = options.signal; return new Promise<Response>(resolve => { finish = resolve; }); });
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const first = modelBytes('/one.glb', controller.signal), other = modelBytes('/one.glb');
  const aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await aborted; expect(upstream.aborted).toBe(false);
  finish(new Response(new Uint8Array([1, 2, 3])));
  const bytes = await other; new Uint8Array(bytes)[0] = 9;
  expect([...new Uint8Array(await modelBytes('/one.glb'))]).toEqual([1, 2, 3]);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('cancels the upstream request when its last consumer leaves and retries failed or cancelled entries', async () => {
  let upstream!: AbortSignal;
  const fetcher = vi.fn((_url, options) => {
    upstream = options.signal;
    return new Promise<Response>((_, reject) => upstream.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError'))));
  });
  vi.stubGlobal('fetch', fetcher);
  const controller = new AbortController();
  const first = modelBytes('/two.glb', controller.signal), aborted = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await aborted; expect(upstream.aborted).toBe(true);
  fetcher.mockImplementationOnce(() => Promise.resolve(new Response('', { status: 503 })));
  await expect(modelBytes('/two.glb')).rejects.toThrow('503');
  fetcher.mockImplementationOnce(() => Promise.resolve(new Response(new Uint8Array([7]))));
  expect([...new Uint8Array(await modelBytes('/two.glb'))]).toEqual([7]);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('invalid model bytes can be discarded so a corrected asset is fetched on retry', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(new Uint8Array([0])))
    .mockResolvedValueOnce(new Response(new Uint8Array([1])));
  vi.stubGlobal('fetch', fetcher);
  await modelBytes('/invalid.glb'); discardModelBytes('/invalid.glb');
  expect([...new Uint8Array(await modelBytes('/invalid.glb'))]).toEqual([1]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

// The garage shows how much of a car has arrived, from the bytes actually read.
it('reports the fraction of a declared length as chunks arrive, to every waiting preview', async () => {
  let push!: (chunk: Uint8Array | null) => void;
  const body = new ReadableStream<Uint8Array>({ start(controller) {
    push = chunk => chunk ? controller.enqueue(chunk) : controller.close();
  } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { headers: { 'content-length': '4' } })));
  const first: (number | null)[] = [], second: (number | null)[] = [];
  const fraction = (list: (number | null)[]) => ({ loaded, total }: { loaded: number; total: number | null }) =>
    list.push(total === null ? null : loaded / total);
  const one = modelBytes('/progress.glb', undefined, fraction(first));
  await vi.waitFor(() => expect(first.at(-1)).toBe(0));
  push(new Uint8Array([1]));
  await vi.waitFor(() => expect(first.at(-1)).toBe(.25));
  const two = modelBytes('/progress.glb', undefined, fraction(second));
  expect(second, 'a preview joining mid-download starts from what has arrived').toEqual([.25]);
  push(new Uint8Array([2, 3, 4])); push(null);
  expect([...new Uint8Array(await one)]).toEqual([1, 2, 3, 4]);
  expect([...new Uint8Array(await two)]).toEqual([1, 2, 3, 4]);
  expect(first.at(-1)).toBe(1); expect(second.at(-1)).toBe(1);
  const later: (number | null)[] = [];
  await modelBytes('/progress.glb', undefined, fraction(later));
  expect(later, 'a cached car reports complete at once').toEqual([1]);
});

it('claims no fraction when the length is missing or counts compressed bytes', async () => {
  for (const headers of [{}, { 'content-length': '2', 'content-encoding': 'gzip' }] as Record<string, string>[]) {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new Uint8Array([5, 6, 7]), { headers })));
    const seen: (number | null)[] = [];
    const url = '/unknown-' + Object.keys(headers).length + '.glb';
    await modelBytes(url, undefined, ({ loaded, total }) => seen.push(total === null ? null : loaded / total));
    expect(seen.slice(0, -1).every(value => value === null), JSON.stringify(headers)).toBe(true);
    expect(seen.at(-1), 'the finished file is complete').toBe(1);
  }
});
