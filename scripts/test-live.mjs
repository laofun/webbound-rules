// Opt-in live check — NOT run by `npm test`. Hits the network.
//   node scripts/test-live.mjs <domain>
// Reads BUILT rules/<domain>.json + src/<domain>/samples.json. Optional cookie
// via env WB_COOKIE_<DOMAIN> ([.-] → _, uppercased), e.g. WB_COOKIE_SANGTACVIET_VIP.
import '../src/_ctx/dom-env.mjs';
import { createScriptableContext } from '../src/_ctx/scriptable-context.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const domain = process.argv[2];
if (!domain) {
  console.log('usage: node scripts/test-live.mjs <domain>   (opt-in; hits the network)');
  process.exit(0);
}

const rulePath = path.join(root, 'rules', domain + '.json');
const samplesPath = path.join(root, 'src', domain, 'samples.json');
A(existsSync(rulePath), `rules/${domain}.json not found — run npm run build`);
A(existsSync(samplesPath), `src/${domain}/samples.json not found`);
const rule = JSON.parse(readFileSync(rulePath, 'utf8'));
const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));
A(rule.parser_type === 'scriptable', `test:live only supports scriptable rules (got ${rule.parser_type})`);
A(samples.book_url && samples.chapter_url, 'samples.json needs non-empty book_url and chapter_url');

const parser = new Function('return ' + rule.script)();
const cookieEnv = 'WB_COOKIE_' + domain.replace(/[.-]/g, '_').toUpperCase();
const cookie = process.env[cookieEnv] || '';
const rateMs = rule.config?.rate_limit_ms ?? 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Real fetch carrying the page as Referer (+ optional Cookie), rate-limited.
const makeFetch = (referer) => async (url) => {
  await sleep(rateMs);
  const headers = { 'User-Agent': 'Mozilla/5.0 WebBound-rules-test', Referer: referer };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

console.log(`live ${domain}${cookie ? ' (with cookie)' : ` (no cookie; set ${cookieEnv} if gated)`}`);

const tocCtx = createScriptableContext({ html: '', url: samples.book_url, config: rule.config, fetch: makeFetch(samples.book_url) });
const chapters = await parser.extractToC(tocCtx);
A(Array.isArray(chapters) && chapters.length > 0, 'extractToC returned no chapters');
A(chapters.every(c => /^https?:\/\//.test(c.url) && c.title), 'a chapter is missing an absolute url or a title');
console.log(`  toc: ${chapters.length} chapters — first: ${chapters[0].title}`);

const chCtx = createScriptableContext({ html: '', url: samples.chapter_url, config: rule.config, fetch: makeFetch(samples.chapter_url) });
const body = await parser.extractChapter(chCtx);
A(typeof body === 'string' && body.length > 150, `extractChapter body too short (${body?.length ?? 0} chars)`);
console.log(`  chapter: ${body.length} chars`);

console.log(`OK: live ${domain} — ToC + chapter fetched and parsed`);
