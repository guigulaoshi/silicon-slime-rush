import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

/** Where the test server lives. One definition, because a hardcoded copy went stale the day the
 *  port moved off Vite's default and three browser tests started failing against nothing. */
// Every checkout gets its own pair of ports, derived from where it sits on disk, so a worktree's
// browser tests never meet a development session (Vite's 5173/4173) or another worktree's test run.
// A hash, not a free-port probe: Playwright re-imports this file in every worker process, and a probe
// there would find the port already taken by our own server and pick a different one.
// SR_E2E_PORT still overrides it. Never a shared server: reuseExistingServer stays false.
function checkoutPort(): number {
  const checkout = fileURLToPath(new URL('../..', import.meta.url));
  const slot = createHash('sha1').update(checkout).digest().readUInt32BE(0) % 4000;
  return 20000 + slot * 2;                 // 20000..27998, even, so base + 1 stays inside the range
}
const base = Number(process.env.SR_E2E_PORT) || checkoutPort();
export const PORT = base;
export const BASE_URL = `http://localhost:${PORT}`;
/**
 * The second server, and the reason there are two.
 *
 * `preview` serves `dist/`, where the tiles are packed into one `tiles.bin`; `dev` serves
 * `public/`, where they are loose files. Those are two different runtime paths, and the
 * suite would otherwise only ever exercise the packed one -- the shape nobody develops against.
 */
export const DEV_PORT = base + 1;
export const DEV_URL = `http://localhost:${DEV_PORT}`;
