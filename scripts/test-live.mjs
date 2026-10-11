// Opt-in live check — NOT run by `npm test`. Hits the network.
//   node scripts/test-live.mjs <domain> [<domain> ...]
//   node scripts/test-live.mjs --all
// Reads BUILT rules/<domain>.json + src/<domain>/samples.json and checks that the
// real site still yields a ToC and a chapter body. Scriptable rules run their
// parser like the sandbox does (ctx.html = the fetched start page); generic rules
// apply toc_url → toc.item → chapter.content/remove (first ToC page only).
// Optional cookie via env WB_COOKIE_<DOMAIN> ([.-] → _, uppercased).
import '../src/_ctx/dom-env.mjs';
import { createScriptableContext } from '../src/_ctx/scriptable-context.mjs';
import { pickCharset, decode } from './fetch-fixture.mjs';
import { parseHTML } from 'linkedom';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const A = (c, m) => { if (!c) throw new Error(m); };

// The site refused us (bot challenge, geo/ISP block) — says nothing about the rule.
class Blocked extends Error {}
const CHALLENGE = /<title>\s*(Just a moment|Attention Required|Vercel Security Checkpoint|DDoS-Guard)/i;

// Real fetch carrying the page as Referer (+ cookie jar), rate-limited, decoded
// like the extension's fetchHtml. Unlike fetchHtml it rejects on HTTP errors so
// a dead site reads as dead, not as an empty page.
function makeFetcher(rateMs, cookie) {
  const jar = new Map();
  for (const item of (cookie || '').split(';')) {
    const [k, ...v] = item.trim().split('=');
    if (k) jar.set(k, v.join('='));
  }
  return (referer) => async (url, init = {}) => {
    await sleep(rateMs);
    const headers = { 'User-Agent': UA, Referer: referer, ...(init.headers || {}) };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    let res;
    try { res = await fetch(url, { ...init, headers }); }
    catch (e) { throw new Blocked(`unreachable from this network: ${url} (${e.cause?.code || e.message})`); }
    for (const raw of res.headers.getSetCookie?.() || []) {
      const [k, ...v] = raw.split(';')[0].trim().split('=');
      if (k) jar.set(k, v.join('='));
    }
    const buf = await res.arrayBuffer();
    const html = decode(buf, pickCharset(res.headers.get('content-type'), buf));
    if (res.headers.get('cf-mitigated') || CHALLENGE.test(html.slice(0, 4000)))
      throw new Blocked(`bot challenge (HTTP ${res.status}) at ${url} — verify in the browser / Hybrid`);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return html;
  };
}

async function checkScriptable(rule, samples, makeFetch) {
  const parser = new Function('return ' + rule.script)();
  const tocFetch = makeFetch(samples.book_url);
  const ctx = createScriptableContext({ html: await tocFetch(samples.book_url), url: samples.book_url, config: rule.config, fetch: tocFetch });
  const t0 = Date.now();
  const chapters = await parser.extractToC(ctx);
  const tocMs = Date.now() - t0;
  A(Array.isArray(chapters) && chapters.length > 0, 'extractToC returned no chapters');
  A(chapters.every(c => /^https?:\/\//.test(c.url) && c.title), 'a chapter is missing an absolute url or a title');
  console.log(`  toc: ${chapters.length} chapters in ${(tocMs / 1000).toFixed(1)}s — first: ${chapters[0].title}`);
  if (tocMs > 25000) console.warn('  WARN: extractToC took >25s; the extension sandbox kills a call at 30s');

  const chFetch = makeFetch(samples.chapter_url);
  const chCtx = createScriptableContext({ html: await chFetch(samples.chapter_url), url: samples.chapter_url, config: rule.config, fetch: chFetch });
  const body = await parser.extractChapter(chCtx);
  A(typeof body === 'string' && body.length > 150, `extractChapter body too short (${body?.length ?? 0} chars)`);
  console.log(`  chapter: ${body.length} chars`);
}

async function checkGeneric(rule, samples, makeFetch) {
  const { toc, chapter } = rule.selectors;
  const f = makeFetch(samples.book_url);
  let tocUrl = samples.book_url;
  let doc = parseHTML(await f(tocUrl)).document;
  if (toc.toc_url) {
    const href = doc.querySelector(toc.toc_url)?.getAttribute('href');
    A(href, `toc_url "${toc.toc_url}" matched nothing on the book page`);
    tocUrl = new URL(href, tocUrl).toString();
    doc = parseHTML(await f(tocUrl)).document;
  }
  const links = [...doc.querySelectorAll(toc.item)].filter(a => a.textContent.trim() && a.getAttribute('href'));
  A(links.length > 0, `toc.item "${toc.item}" matched no links on ${tocUrl}`);
  console.log(`  toc (page 1): ${links.length} chapters — first: ${links[0].textContent.trim()}`);

  const ch = parseHTML(await makeFetch(samples.chapter_url)(samples.chapter_url)).document;
  // linkedom drops a missing <body> tag that cheerio (the extension) would infer.
  const el = ch.querySelector(chapter.content) || (chapter.content === 'body' ? ch.documentElement : null);
  A(el, `chapter.content "${chapter.content}" matched nothing`);
  for (const sel of chapter.remove || []) el.querySelectorAll(sel).forEach(n => n.remove());
  const text = el.textContent.replace(/\s+/g, '');
  if (!text) {
    // Container is there but filled by page JS; the extension's Hybrid fallback renders it.
    console.warn(`  WARN: chapter.content is empty in static HTML (JS-rendered) — verify in the browser`);
    return;
  }
  A(text.length > 150, `chapter text too short (${text.length} chars)`);
  console.log(`  chapter: ${text.length} chars of text`);
}

async function checkDomain(domain) {
  const rulePath = path.join(root, 'rules', domain + '.json');
  const samplesPath = path.join(root, 'src', domain, 'samples.json');
  A(existsSync(rulePath), `rules/${domain}.json not found — run npm run build`);
  A(existsSync(samplesPath), `src/${domain}/samples.json not found`);
  const rule = JSON.parse(readFileSync(rulePath, 'utf8'));
  const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));
  A(samples.book_url && samples.chapter_url, 'samples.json needs non-empty book_url and chapter_url');

  const cookieEnv = 'WB_COOKIE_' + domain.replace(/[.-]/g, '_').toUpperCase();
  const cookie = process.env[cookieEnv];
  console.log(`live ${domain} [${rule.parser_type}]${cookie ? ' (with cookie)' : ''}`);
  const makeFetch = makeFetcher(rule.config?.rate_limit_ms ?? 1000, cookie);
  await (rule.parser_type === 'scriptable' ? checkScriptable : checkGeneric)(rule, samples, makeFetch);
}

const args = process.argv.slice(2);
const domains = args.includes('--all')
  ? readdirSync(path.join(root, 'rules')).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort()
  : args;
if (!domains.length) {
  console.log('usage: node scripts/test-live.mjs <domain>... | --all   (opt-in; hits the network)');
  process.exit(0);
}

const failed = [], blocked = [];
for (const d of domains) {
  try {
    await checkDomain(d);
    console.log(`OK: live ${d}`);
  } catch (e) {
    if (e instanceof Blocked) { console.warn(`BLOCKED: live ${d} — ${e.message}`); blocked.push(d); continue; }
    console.error(`FAIL: live ${d} — ${e.message}`);
    failed.push(d);
  }
}
if (domains.length > 1) {
  const ok = domains.length - failed.length - blocked.length;
  console.log(`\n${ok} ok, ${failed.length} failed${failed.length ? ' (' + failed.join(', ') + ')' : ''}, ${blocked.length} blocked${blocked.length ? ' (' + blocked.join(', ') + ')' : ''}`);
}
// Blocked sites can't be judged from here; only real rule failures fail the run.
process.exit(failed.length ? 1 : 0);
