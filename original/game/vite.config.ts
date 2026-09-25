import { buildCredits, creditsNotices } from './build/credits';
import { OBFUSCATION } from './build/obfuscation';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import { playable } from './src/app/tracks';
import { mountStartup } from './src/ui/Startup';
import { detectLanguage, languagePreference } from './src/ui/i18n';
import { readSavedData, SAVE_KEY } from './src/app/Save';
import { PLANNED_GAME_URL, publicGameUrl } from './src/app/Publication';
import { socialImageUrl, socialMetaTags } from './build/socialMeta';
import en from './src/ui/locales/en.json' with { type: 'json' };
import zh from './src/ui/locales/zh.json' with { type: 'json' };

function startupShell(): Plugin {
  return {
    name: 'sr-startup-shell',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const css = readFileSync(resolve(__dirname, 'src/ui/loading-bar.css'), 'utf8');
        const texts = Object.fromEntries(Object.entries({ en, zh }).map(([language, table]) =>
          [language, Object.fromEntries(Object.entries(table).filter(([key]) =>
            key === 'app.title' || key.startsWith('boot.')))]));
        const json = JSON.stringify(texts).replace(/</g, '\\u003c');
        const script = `(${mountStartup.toString()})(${json},${JSON.stringify(SAVE_KEY)},`
          + `${readSavedData.toString()},${languagePreference.toString()},${detectLanguage.toString()});`;
        // Link previews: same address rule as the watermark -- the verified public page
        // when the release build has one, the planned page otherwise.
        const home = publicGameUrl(process.env.VITE_PUBLIC_GAME_URL) ?? PLANNED_GAME_URL;
        html = html.replace('<!-- social-meta -->', socialMetaTags(home, socialImageUrl(process.env.VITE_PUBLIC_ASSET_ORIGIN)));
        return html.replace('<!-- startup-shell -->', `<style>${css}
          #startup { position:fixed; inset:0; z-index:200; display:flex; flex-direction:column;
            align-items:center; justify-content:center; gap:20px; padding:24px; text-align:center;
            color:#eef3f8; background:#080f17; font:16px/1.5 system-ui,sans-serif; overflow:auto; }
          #startup h1 { display:flex; flex-direction:column; align-items:center; gap:10px;
            font-size:clamp(26px,5vw,48px); margin:0; }
          #startup h1 img { width:96px; height:96px; object-fit:contain; }
          #startup p { margin:0; max-width:36em; }
          #startup button { border:1px solid #ff8a3d; padding:12px 24px; border-radius:12px;
            font:inherit; color:inherit; background:#18212a; cursor:pointer; }
          #startup .startup-language { position:absolute; top:12px; right:12px; padding:8px 12px; }
          #startup [hidden] { display:none!important; }
        </style><section id="startup" aria-busy="true">
          <h1><img src="./brand/slime-race-mark-180.png" alt=""><span>Silicon Slime Rush</span></h1><p role="status"></p>
          <div class="loading-bar" aria-hidden="true"><div class="loading-bar-fill"></div></div>
          <button hidden type="button"></button>
        </section><script>${script}</script>`);
      },
    },
  };
}

/* */
export function packTiles(distDir = resolve(__dirname, 'dist')): Plugin {
  return {
    name: 'sr-pack-tiles',
    apply: 'build',
    async closeBundle() {
      const root = resolve(distDir, 'tracks');
      let dirs: string[] = [];
      try {
        dirs = readdirSync(root);
      } catch {
        return;                       // no tracks built into this dist; nothing to pack
      }
      for (const id of dirs) {
        const dir = resolve(root, id);
        // Cached public outputs may outlive a retired route. The playable catalogue owns release membership.
        if (!playable(id, true)) { rmSync(dir, { recursive: true, force: true }); continue; }
        const tiles = resolve(dir, 'tiles');
        if (!statSync(tiles, { throwIfNoEntry: false })?.isDirectory()) {
          // Already packed is fine; nothing at all is not. A track that ships with neither shape is
          // a track the game cannot load, and finding that out from a black screen after upload is
          // the expensive way. Fail the build instead.
          if (statSync(resolve(dir, 'tiles.bin'), { throwIfNoEntry: false })?.isFile()) continue;
          throw new Error(`${id}: no tiles/ to pack and no tiles.bin -- this track would ship broken`);
        }
        const docPath = resolve(dir, 'track.json');
        const doc = JSON.parse(readFileSync(docPath, 'utf-8')) as
          { tiles: { name: string; offset?: number; length?: number }[]; tilePack?: unknown };
        // The index's own order, not the directory's: the index is what the runtime reads, and a
        // pack written in a different order would still validate and still be wrong.
        const out = createWriteStream(resolve(dir, 'tiles.bin'));
        let at = 0;
        for (const tile of doc.tiles) {
          const bytes = readFileSync(resolve(tiles, `${tile.name}.glb`));
          out.write(bytes);
          tile.offset = at;
          tile.length = bytes.length;
          at += bytes.length;
        }
        await new Promise<void>((done, fail) => out.end((err?: Error) => (err ? fail(err) : done())));
        doc.tilePack = { file: 'tiles.bin', bytes: at };
        writeFileSync(docPath, JSON.stringify(doc, null, 1));
        // The loose copies must not ship: they are the same bytes twice, and they are exactly the
        // file count the pack exists to avoid.
        rmSync(tiles, { recursive: true, force: true });
      }
    },
  };
}

/**
 * Notes for us, stripped out of anything that ships (: no development details
 * in the uploaded build). The pipeline's track schema explains itself in `description` fields and the
 * billboard manifest in `_note`; both are bundled verbatim, so the build reads them for their rules and
 * drops the prose. Nothing at runtime reads either field -- the schema validates shape, and the boards
 * read `image`, `platform` and `target`.
 */
function withoutDevNotes<T>(value: T): T {
  if (Array.isArray(value)) return value.map(item => withoutDevNotes(item)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'description' && key !== '$comment' && !key.startsWith('_'))
      .map(([key, item]) => [key, withoutDevNotes(item)])) as unknown as T;
  }
  return value;
}

/** The same strip for the JSON files copied out of `public/`, which never pass through a bundler. */
function stripCopiedNotes(): Plugin {
  return {
    name: 'sr-strip-copied-notes',
    apply: 'build',
    closeBundle() {
      const file = resolve(__dirname, 'dist/billboards/manifest.json');
      if (!existsSync(file)) return;
      writeFileSync(file, JSON.stringify(withoutDevNotes(JSON.parse(readFileSync(file, 'utf-8')))));
    },
  };
}

/** Schema prose, dropped before Vite turns the file into a module. */
function stripSchemaNotes(): Plugin {
  return {
    name: 'sr-strip-schema-notes',
    enforce: 'pre',
    transform(code, id) {
      if (!id.endsWith('track.schema.json')) return null;
      return { code: JSON.stringify(withoutDevNotes(JSON.parse(code))), map: null };
    },
  };
}

const credits = buildCredits(resolve(__dirname, '..'));

/**
 * The release build ships obfuscated. Minifying was already
 * on -- Vite's production build runs esbuild and emits no source map -- so this is the second half.
 *
 * Two limits, both about what obfuscation costs rather than what it buys:
 *
 * * **Only our own code.** three.js is vendor code that is already minified and public; running it
 *   through a string-array transform again would add hundreds of kilobytes to a 450 MB budget's
 *   worst chunk and protect nothing. `manualChunks` puts it in its own chunk so this plugin can
 *   tell the two apart, and the wasm glue chunk is skipped for the same reason.
 * * **Nothing that costs frames.** Control-flow flattening, dead-code injection and
 *   numbers-to-expressions are the options that make a physics loop miss its step budget, and
 *   `debugProtection` freezes a player's browser if they ever open devtools. All off. What stays is
 *   renaming and string extraction, which the engine pays for once at parse time.
 *
 * Off by default so that development builds stay readable; `tools/release_package.py` turns it on,
 * which is what makes "the uploaded build is obfuscated" a property of the upload command rather
 * than of somebody remembering to pass a flag.
 */
function obfuscateRelease(): Plugin {
  const VENDOR = /vendor|rapier/;
  return {
    name: 'sr-obfuscate',
    apply: 'build',
    enforce: 'post',
    // writeBundle -- after the files are on disk -- and not any earlier hook. Vite finishes a chunk's
    // code in stages, each one finding a marker by searching the text: renderChunk still has
    // `!~{003}~` where a hashed chunk name goes, and generateBundle still has `__VITE_PRELOAD__` where
    // the list of stylesheets a lazy chunk needs goes. The string-array transform hides any string it
    // touches in a base64 table, so every search after it finds nothing. Both happened on
    //First the game asked for `main-!~{003}~.js` and never started, then it started with
    // no stylesheet at all. Rewriting the finished files is the one point with no search left to break.
    async writeBundle(options, bundle) {
      if (process.env.SR_OBFUSCATE !== '1') return;
      const { default: obfuscator } = await import('javascript-obfuscator');
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || VENDOR.test(chunk.name) || VENDOR.test(chunk.fileName)) continue;
        const file = resolve(options.dir ?? resolve(__dirname, 'dist'), chunk.fileName);
        writeFileSync(file, obfuscator.obfuscate(readFileSync(file, 'utf8'), OBFUSCATION).getObfuscatedCode());
      }
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_CREDITS__: JSON.stringify(credits.metadata),
    __BILLBOARD_MANIFEST__: JSON.stringify(withoutDevNotes(JSON.parse(readFileSync(resolve(__dirname, 'public/billboards/manifest.json'), 'utf-8')))),
  },
  plugins: [stripSchemaNotes(), startupShell(), packTiles(), creditsNotices(credits.notices), stripCopiedNotes(), obfuscateRelease()],
  base: './',
  build: {
    target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 2000,
    // three.js in its own chunk so `obfuscateRelease` can leave vendor code alone. It also means a
    // change to our code no longer invalidates a megabyte of unchanged library in the player's cache.
    rollupOptions: { output: { manualChunks: (id: string) => (id.includes('node_modules/three') ? 'vendor-three' : undefined) } },
  },
  // no-store on the dev server, because the tracks are static files the pipeline rewrites under
  // it. Without it a rebuilt tile keeps being served from the browser cache: the fix is in the
  // build, the bug is still on the screen, and there is no way to tell those two apart from a
  // screenshot. Costs nothing -- this server never faces a player.
  server: {
    port: 5173, strictPort: true, fs: { allow: ['..'] },
    headers: { 'Cache-Control': 'no-store' },
  },
  // the preview server is only ever a dev tool, and it is the thing a tunnel points at when the
  // build needs to be looked at from a phone; without this it answers 403 to any host it does not
  // already know
  preview: { port: 4173, strictPort: true, allowedHosts: true, headers: { 'Cache-Control': 'no-store' } },
  test: { environment: 'jsdom', include: ['test/**/*.test.ts'] },
});
