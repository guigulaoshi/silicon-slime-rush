import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import type { Plugin } from 'vite';

/** What `git status` says has changed in `root`; tests pass their own because Vitest's jsdom run cannot mock a Node built-in. */
const gitChanges = (root: string): string =>
  execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], {cwd: root, encoding: 'utf8'});

/** Build metadata comes from game/package.json and the installed packages. */
export function licenseNotice(directory: string): string {
  const name = readdirSync(directory).find(name => /^licen[sc]e(?:\.md|\.txt)?$/i.test(name));
  if (!name) throw new Error(`Missing license notice in ${directory}`);
  return readFileSync(resolve(directory, name), 'utf8');
}

export function buildCredits(root: string, changes: (root: string) => string = gitChanges) {
  const changed = changes(root).trim();
  const dirty = !!changed;
  // An upload built from uncommitted changes matches no commit, and its About page says so to every
  // player. tools/release_package.py
  // sets SR_RELEASE, so the one command that makes an upload refuses such a tree here, where the judgement
  // is made, instead of a second copy of it in Python.
  if (dirty && process.env.SR_RELEASE === '1')
    throw new Error(`Refusing a release build from a tree with uncommitted changes -- commit first:\n${changed}`);
  const assets = readFileSync(resolve(root, 'ASSETS.md'), 'utf8');
  const sourceLinks = assets.split('\n').filter(line => line.startsWith('|')).flatMap(line =>
    [...line.matchAll(/\[([^\]]+)\]\((https:\/\/[^)]+)\)/g)].map(m => ({name: m[1]!, url: m[2]!})));
  const pkg = JSON.parse(readFileSync(resolve(root, 'game/package.json'), 'utf8'));
  const packageFile = (require: NodeJS.Require, name: string): string => {
    // License metadata is on disk even when a package deliberately hides package.json exports.
    const file = require.resolve.paths(name)?.map(base => resolve(base, name, 'package.json')).find(existsSync);
    if (!file) throw new Error(`Missing installed package metadata: ${name}`);
    return file;
  };
  const libraries: {name: string; version: string; license: string; notice: string}[] = [];
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const installed = JSON.parse(readFileSync(file, 'utf8'));
    libraries.push({name: installed.name, version: installed.version, license: installed.license,
      notice: licenseNotice(dirname(file))});
    const require = createRequire(file);
    for (const name of Object.keys(installed.dependencies ?? {})) visit(packageFile(require, name));
  };
  const require = createRequire(resolve(root, 'game/package.json'));
  for (const name of Object.keys(pkg.dependencies)) visit(packageFile(require, name));
  // What players see is the release, not the commit: a short revision is a development detail, and the
  // build must not carry one. `dirty` stays, because it only ever shows on a
  // build made from an unclean tree -- never on a release (refused above). credits.txt says it too, in
  // words the About string does not share, so release_audit.py can find it in any build it is shown.
  const version = (pkg.version as string).split('.').slice(0, 2).join('.');   // package.json 2.0.0 is version 2.0
  const title = JSON.parse(readFileSync(resolve(root, 'game/src/ui/locales/en.json'), 'utf8'))['app.title'];
  const licenses = [...libraries.map(lib => ({heading: `${lib.name} ${lib.version} (${lib.license})`, text: lib.notice})),
    {heading: 'Noto Sans SC (OFL-1.1)', text: readFileSync(resolve(root, 'pipeline/assets/fonts/OFL.txt'), 'utf8')}];
  const notices = [`${title} — credits and license notices`, `Version ${version}${dirty ? ` ${UNCOMMITTED}` : ''}`, '', plainText(assets),
    heading('License texts', '='), ...licenses.flatMap(license => [heading(license.heading, '-'), license.text.replace(/^\n+|\s+$/g, ''), ''])]
    .join('\n').replace(/\n{3,}/g, '\n\n');
  return { metadata: { version, dirty, sourceLinks, libraries: libraries.map(({notice: _, ...lib}) => lib) }, notices };
}

/** The words tools/release_audit.py looks for in credits.txt; keep the two in step. */
export const UNCOMMITTED = '(built from uncommitted changes)';

const heading = (text: string, rule: string) => `\n${text}\n${rule.repeat(text.length)}\n`;

/** ASSETS.md is Markdown for the repository; players open credits.txt as plain text. */
function plainText(markdown: string): string {
  const inline = (text: string) => text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1 <$2>').replace(/`([^`]+)`/g, '$1');
  let columns: string[] = [];
  return markdown.split('\n').flatMap(line => {
    if (!line.startsWith('|')) {
      columns = [];
      const title = /^#+ (.*)$/.exec(line)?.[1];
      return title ? [heading(title, '=')] : [inline(line)];
    }
    const cells = line.slice(1, -1).split('|').map(cell => inline(cell.trim()));
    if (cells.every(cell => /^-+$/.test(cell))) return [];
    if (!columns.length) { columns = cells; return []; }
    return [cells[0]!, ...cells.slice(1).map((cell, i) => `  ${columns[i + 1]}: ${cell}`), ''];
  }).join('\n');
}

export function creditsNotices(notices: string): Plugin {
  return { name: 'sr-credits-notices',
    configureServer(server) { server.middlewares.use('/credits.txt', (_request, response) => {
      response.setHeader('Content-Type', 'text/plain; charset=utf-8'); response.end(notices);
    }); },
    generateBundle() { this.emitFile({type: 'asset', fileName: 'credits.txt', source: notices}); },
  };
}
