import type { ObfuscatorOptions } from 'javascript-obfuscator';

/**
 * The release build's obfuscation settings (vite.config.ts `obfuscateRelease` says why each is on or off).
 *
 * The string table is not encoded. With base64 on, about three strings in four became
 * unreadable to `tools/release_audit.py`, the check that scans the upload before it goes out: on
 * its `--links` pass saw 44 of the build's 63 web addresses and never opened the other 19.
 * The addresses are on screen for every player anyway; the audit has to read what it signs off.
 * the player confirmed this (「这个没关系，去掉加密」): keep compaction and renaming,
 * leave string encoding off. Do not turn it back on without asking.
 */
export const OBFUSCATION: ObfuscatorOptions = {
  compact: true,
  identifierNamesGenerator: 'mangled-shuffled',
  renameGlobals: false,
  stringArray: true,
  stringArrayThreshold: 0.75,
  stringArrayEncoding: [],
  // File names stay readable: they are no secret (the browser's network panel lists them), and
  // `tools/release_audit.py` checks every emitted stylesheet is named by some script -- a check that
  // can only see a name the string table has not hidden.
  reservedStrings: ['\\.(css|js|wasm|json|png|jpe?g|webp|glb|bin|webm|mp4)$'],
  splitStrings: false,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: false,
  selfDefending: false,
  debugProtection: false,
  simplify: true,
  target: 'browser',
};
