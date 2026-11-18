// Download a book's ToC and chapters with a BUILT scriptable rule, from node.
//   node scripts/grab.mjs <book_url> --out DIR [--toc-only] [--idx 1,5,10-20] [--curl]
//   npm run grab -- https://xsw.tw/book/1758250/ --out /tmp/x --idx 149-151
// Rule = rules/<host>.json (leading www./m. stripped). Writes DIR/toc.json
// ([{i, title, url}], i 1-based) and DIR/NNNN.txt (one paragraph per line).
// Resumable: existing NNNN.txt are skipped; a failed chapter is logged and the
// run goes on, exit 1 at the end. No --idx = every chapter. --curl: fetch through
// curl, for sites Node's fetch can't reach: 403 to Node (ixdzs8.com), or a TLS
// chain Node won't verify (m.xsw.tw: "unable to verify the first certificate").
import '../src/_ctx/dom-env.mjs';
import { createScriptableContext } from '../src/_ctx/scriptable-context.mjs';
import { pickCharset, decode } from './fetch-fixture.mjs';
import { parseHTML } from 'linkedom';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const CHALLENGE = /<title>\s*(Just a moment|Attention Required|Vercel Security Checkpoint|DDoS-Guard)/i;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export function parseIdx(spec, max) {
  const out = new Set();
  for (const part of spec.split(',')) {
    const [a, b] = part.split('-').map(Number);
    for (let i = a; i <= (b || a); i++) if (i >= 1 && i <= max) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}

export function htmlToText(html) {
  const marked = html.replace(/<br\s*\/?>|<\/(p|div|h\d)>/gi, '\n');
  const { document } = parseHTML(`<html><body>${marked}</body></html>`);
  return document.body.textContent.split('\n').map(l => l.trim()).filter(Boolean).join('\n');
}

function loadRule(url) {
  const host = new URL(url).hostname.replace(/^(www|m)\./, '');
  const file = path.join(root, 'rules', host + '.json');
  if (!existsSync(file)) throw new Error(`no rules/${host}.json — run npm run build`);
  const rule = JSON.parse(readFileSync(file, 'utf8'));
  if (rule.parser_type !== 'scriptable') throw new Error(`${host}: only scriptable rules are supported (got ${rule.parser_type})`);
  return rule;
}

// Raw request → { status, type, buf: ArrayBuffer }.
async function viaFetch(url, init) {
  const res = await fetch(url, init);
  return { status: res.status, type: res.headers.get('content-type'), buf: await res.arrayBuffer(), wall: res.headers.get('cf-mitigated') };
}

async function viaCurl(url, { method = 'GET', headers = {}, body } = {}) {
  const args = ['-sL', '--max-time', '60', '-X', method, '-w', '\n%{http_code} %{content_type}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body != null) args.push('--data-binary', String(body));
  const { stdout } = await promisify(execFile)('curl', [...args, url], { encoding: 'buffer', maxBuffer: 64 << 20 });
  const cut = stdout.lastIndexOf(10), tail = stdout.subarray(cut + 1).toString(), sp = tail.indexOf(' ');
  return { status: +tail.slice(0, sp), type: tail.slice(sp + 1), buf: stdout.buffer.slice(stdout.byteOffset, stdout.byteOffset + cut) };
}

const makeFetch = (rateMs, referer, get) => async (url, init = {}) => {
  await sleep(rateMs);
  const res = await get(url, { ...init, headers: { 'User-Agent': UA, Referer: referer, ...(init.headers || {}) } });
  const html = decode(res.buf, pickCharset(res.type, res.buf));
  if (res.wall || CHALLENGE.test(html.slice(0, 4000))) throw new Error(`bot challenge at ${url}`);
  if (res.status < 200 || res.status > 299) throw new Error(`HTTP ${res.status} for ${url}`);
  return html;
};

async function main() {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
  const bookUrl = args[0], out = opt('--out');
  if (!bookUrl || bookUrl.startsWith('--') || !out) {
    console.error('usage: node scripts/grab.mjs <book_url> --out DIR [--toc-only] [--idx 1,5,10-20] [--curl]');
    process.exit(2);
  }
  const rule = loadRule(bookUrl);
  const parser = new Function('return ' + rule.script)();
  const rate = rule.config?.rate_limit_ms ?? 1000;
  const get = args.includes('--curl') ? viaCurl : viaFetch;
  mkdirSync(out, { recursive: true });

  const tocFetch = makeFetch(rate, bookUrl, get);
  const toc = (await parser.extractToC(createScriptableContext({ html: await tocFetch(bookUrl), url: bookUrl, config: rule.config, fetch: tocFetch })))
    .map((c, k) => ({ i: k + 1, title: c.title, url: c.url }));
  writeFileSync(path.join(out, 'toc.json'), JSON.stringify(toc, null, 1));
  console.log(`toc: ${toc.length} chapters → ${out}/toc.json (last: ${toc.at(-1)?.title})`);
  if (args.includes('--toc-only')) return;

  const pick = opt('--idx') ? parseIdx(opt('--idx'), toc.length) : toc.map(c => c.i);
  const failed = [];
  for (const i of pick) {
    const file = path.join(out, String(i).padStart(4, '0') + '.txt');
    if (existsSync(file)) continue;
    const { url, title } = toc[i - 1];
    try {
      const f = makeFetch(rate, url, get);
      const body = await parser.extractChapter(createScriptableContext({ html: await f(url), url, config: rule.config, fetch: f }));
      writeFileSync(file, title + '\n' + htmlToText(body) + '\n');
      console.log(`${i} ${title}`);
    } catch (e) {
      console.error(`FAIL ${i} ${title}: ${e.message}`);
      failed.push(i);
    }
  }
  if (failed.length) {
    console.error(`${failed.length} failed: ${failed.join(',')} — rerun the same command to retry`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
