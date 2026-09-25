import { createGzip } from 'node:zlib';
import { createReadStream, existsSync, statSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, relative, sep } from 'node:path';

/**
 * The staged upload package, served the way itch.io serves it.
 *
 * Both test the package rather than a fresh build, and both need the same two
 * things from a server: byte ranges (the tiles are fetched with `bytes=`, and a server that only
 * answers 200 exercises the safety net in `src/world/streaming.ts` instead of the real path), and a
 * count of how many range requests actually happened, so "it drove" cannot mean "it fell back".
 */
export const PACKAGE_ROOT = resolve(process.cwd(), 'release', 'package');

/**
 * Is there a package to test, staged by the run that is asking?
 *
 * The staging directory is gitignored and long-lived, so "a package exists" is not "a package of the
 * code under test", and comparing it with `dist/` cannot answer that either: every Playwright run
 * rebuilds `dist` through the config's own webServer, so the two are never equal for long.
 * `tools/release_package.py` sets `SR_PACKAGE=1` when it runs these specs seconds after staging, which
 * is the only moment the package and the code are known to match. Anywhere else, these specs skip.
 */
export function stagedByThisRelease(root = PACKAGE_ROOT): boolean {
  return process.env.SR_PACKAGE === '1' && existsSync(join(root, 'index.html'));
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.webp': 'image/webp', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.txt': 'text/plain',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

export interface PackageServer {
  base: string;
  /** How many requests asked for a byte range. */
  ranges(): number;
  /** How many requests fetched a file whose name ends in `.bin` -- the tile packs. */
  packs(): number;
  close(): Promise<void>;
}

/** Whether `file` exists under `root` with exactly this spelling. macOS says yes to any case; itch.io does not. */
function existsExactCase(root: string, file: string): boolean {
  let dir = root;
  for (const part of relative(root, file).split(sep)) {
    if (!readdirSync(dir).includes(part)) return false;
    dir = join(dir, part);
  }
  return true;
}

/**
 * `like: 'itch'` serves the way itch.io's CDN was measured to: every Range header ignored --
 * 200 and the whole file, uncompressed -- and every other response gzip-encoded. The ranged server alone never showed the
 * failure that stopped Golden Gate loading on the live page, because it answers exactly what is asked.
 */
export async function servePackage(root = PACKAGE_ROOT, like: 'ranges' | 'itch' = 'ranges'): Promise<PackageServer> {
  let ranges = 0;
  let packs = 0;
  const server = createServer((request, response) => {
    const path = join(root, normalize(decodeURIComponent((request.url ?? '/').split('?')[0]!)).replace(/^(\.\.[/\\])+/, ''));
    const file = existsSync(path) && statSync(path).isDirectory() ? join(path, 'index.html') : path;
    if (!existsSync(file) || (like === 'itch' && !existsExactCase(root, file))) {
      response.statusCode = 404; response.end('no'); return;
    }
    response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    response.setHeader('Accept-Ranges', 'bytes');
    const size = statSync(file).size;
    if (file.endsWith('.bin')) packs++;
    if (like === 'itch') {
      // Measured on the live page: a request carrying Range (the browser also says it will take no
      // compression) gets 200 and the whole file uncompressed; any other request gets it gzipped.
      if (request.headers.range) { createReadStream(file).pipe(response); return; }
      response.setHeader('Content-Encoding', 'gzip');
      createReadStream(file).pipe(createGzip()).pipe(response);
      return;
    }
    const asked = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
    if (asked) {
      ranges++;
      const start = asked[1] ? Number(asked[1]) : Math.max(0, size - Number(asked[2]));
      const end = asked[1] ? (asked[2] ? Math.min(Number(asked[2]), size - 1) : size - 1) : size - 1;
      response.statusCode = 206;
      response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      createReadStream(file, { start, end }).pipe(response);
      return;
    }
    createReadStream(file).pipe(response);
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  return {
    base: `http://127.0.0.1:${port}`,
    ranges: () => ranges,
    packs: () => packs,
    close: () => new Promise<void>(done => server.close(() => done())),
  };
}
