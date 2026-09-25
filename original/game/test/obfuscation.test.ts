import { expect, it } from 'vitest';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { OBFUSCATION } from '../build/obfuscation';

// Tools/release_audit.py reads the upload as text. With an encoded string table it could not
// see about three strings in four, so --links never opened 19 of the build's 63 addresses.
it('leaves every web address in the release build readable to the upload audit', () => {
  const urls = Array.from({ length: 40 }, (_, i) => `https://example.org/page-${i}`);
  const source = `const links={${urls.map((url, i) => `k${i}:\`${url}\``).join(',')}};console.log(links);`;
  const out = JavaScriptObfuscator.obfuscate(source, OBFUSCATION).getObfuscatedCode();
  for (const url of urls) expect(out).toContain(url);
});
