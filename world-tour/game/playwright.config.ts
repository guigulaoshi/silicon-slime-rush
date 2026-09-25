import { defineConfig } from '@playwright/test';
import { BASE_URL, DEV_PORT, DEV_URL, PORT } from './e2e/server';

// PERF_REAL_GPU means "assert performance numbers" (visible Metal, the machine to itself).
const REAL_GPU = process.env.PERF_REAL_GPU === '1';
// Every other run also renders on the GPU (headless Metal). SwiftShader put 3D drawing on the
// CPU -- one browser's gpu-process took seven cores -- so the suite was CPU-bound: the same 20 tests took
// 4 min 47 s on two software workers (one timeout) and 52 s on four headless Metal workers, all green.
// SR_E2E_SOFTWARE=1 opts back into SwiftShader; the pixel baseline uses it, because its eight images were
// recorded there and a renderer change would move every pixel.
const GPU = REAL_GPU || process.env.SR_E2E_SOFTWARE !== '1';

/* */
export default defineConfig({
  testDir: './e2e',
  // Keep Playwright's own cleanup inside this child. `e2e:version` starts Playwright twice, while
  // disposable captures from both halves accumulate beside it in `test-results/evidence`.
  outputDir: 'test-results/playwright',
  // Baseline pictures live where the repo already keeps them and where a person already looks,
  // rather than in a `__snapshots__` folder nobody opens. The file the diff runs against and the
  // file a person opens are then the same file, which is the only way a stale one gets noticed.
  snapshotPathTemplate: '{testDir}/../../tools/baselines/sydney/{arg}{ext}',
  // Missing review files are failures. Only `baseline:update --update-snapshots` may create them.
  updateSnapshots: 'none',
  timeout: 90_000,
  // The version gate now includes 24 full AI rosters and 11 dual drives, including four 64.8 km
  // highway runs. This bounds the whole invocation; menu timeouts and per-drive game-time
  // assertions remain unchanged, so a stalled individual case still fails at its own boundary.
  globalTimeout: 120 * 60 * 1000,
  // Test files are a poor scheduling boundary here: drive.spec contains every route, so with file-
  // only parallelism one worker spent six minutes on it while the other ran out of work. Individual
  // tests share no browser state; let both workers take routes from the same file.
  fullyParallel: true,
  // Performance checks still need the machine to themselves. GPU rendering leaves the CPU to physics,
  // so four browsers keep fixed 60 Hz steps; two software-rendered browsers were already the CPU's limit.
  workers: REAL_GPU ? 1 : GPU ? 4 : 2,
  // 'list' goes to stdout, which is buffered when it is a pipe; the progress file is not, and is
  // the only way to watch a run that has not finished yet
  reporter: [['list'], ['./e2e/progress-reporter.ts']],
  use: {
    baseURL: BASE_URL,
    viewport: { width: 1280, height: 720 },
    // Performance defaults to visible Metal; opt-in headless Metal avoids stealing focus.
    // The performance spec rejects software renderers in either mode. Ordinary runs are headless.
    headless: !REAL_GPU || process.env.PERF_HEADLESS === '1',
    launchOptions: {
      // software WebGL is deterministic and available on every machine, and stays the opt-in for the
      // pixel baseline and for machines without a usable GPU
      // Test browsers play the game's audio through the Mac's speakers otherwise, while the player is
      // working next to them; no spec listens to real output (audio checks read Web Audio state).
      args: ['--mute-audio', ...(GPU
        ? ['--use-gl=angle', '--use-angle=metal', '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
        : ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--disable-dev-shm-usage'])],
    },
  },
  webServer: [{
    // Build first. `vite preview` serves whatever is in dist/, so without this the suite happily
    // tests the last build anyone happened to make -- source changes appear to do nothing, and a
    // fix and a no-op look identical.
    //
    // Its own port, and never reuse someone else's server. Vite's default 4173 is also every other
    // project's default: attaching to a preview from another checkout runs this suite against a
    // build that is not the one under test, and it fails in ways that do not reproduce.
    // `npm run build` already runs `prebuild`, which is the asset check: every browser
    // run makes the map data match the code before it serves a byte of it.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    // A genuinely cold map build can take several minutes. Product-specific cache keys keep
    // unrelated generators (for example social billboard images) from paying that cost.
    timeout: 600_000,
  }, {
    // And a dev server, serving `public/` with the tiles loose. It is what every development day
    // actually looks at, and without it the suite only ever proves the packed shape works.
    command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
    url: DEV_URL,
    reuseExistingServer: false,
    timeout: 600_000,          // same reason as above: `predev` may have a genuine cold build
  }],
});
