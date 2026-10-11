// Save a page as a UTF-8 fixture, decoded the way the extension decodes it
// (port of NovelPacker-Extension/src/features/crawler/parser/fetchHtml.ts:
// Content-Type charset → <meta> charset → utf-8; gb2312 upgraded to gbk).
//   node scripts/fetch-fixture.mjs <url> <out-file> [charset]
//   npm run fixture -- <url> src/<domain>/fixtures/book.html
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const NON_UTF8 = /^(gb2312|gbk|gb18030|big5|shift[-_]?jis|euc[-_]?kr|euc[-_]?jp)$/i;

export function pickCharset(contentType, buf) {
  let charset = (/charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType || '') || [])[1]?.toLowerCase() || null;
  if (!charset || !NON_UTF8.test(charset)) {
    const head = new TextDecoder('ascii').decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
    const m = /<meta[^>]+charset\s*=\s*["']?([^"'>\s;]+)/i.exec(head)
      || /<meta[^>]+http-equiv\s*=\s*["']?content-type[^>]*content\s*=\s*["'][^"']*charset\s*=\s*([^"';\s]+)/i.exec(head);
    if (m) charset = m[1].toLowerCase();
  }
  if (!charset) charset = 'utf-8';
  return charset === 'gb2312' ? 'gbk' : charset;
}

export function decode(buf, charset) {
  try { return new TextDecoder(charset).decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

async function main() {
  const [url, out, override] = process.argv.slice(2);
  if (!url || !out) {
    console.error('usage: node scripts/fetch-fixture.mjs <url> <out-file> [charset]');
    process.exit(1);
  }
  const res = await fetch(url, { headers: {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  } });
  if (!res.ok) { console.error(`HTTP ${res.status} for ${url}`); process.exit(1); }
  const buf = await res.arrayBuffer();
  const charset = override?.toLowerCase() || pickCharset(res.headers.get('content-type'), buf);
  const html = decode(buf, charset);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, html);
  console.log(`saved ${out} (${charset}, ${html.length} chars)`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
