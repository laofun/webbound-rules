// Runnable check for sangtacviet.vip's extractToC: run `node tests/sangtacviet.toc.test.mjs`.
// Feeds the rule's ctx.fetch the REAL getchapterlist body (what the extension's
// in-tab fetch returns) and asserts it becomes 95 absolute chapter URLs. Fails
// loudly if the JSON slice / `-//-`/`-/-` split / URL build ever regresses.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rule = JSON.parse(fs.readFileSync(path.join(dir, '../rules/sangtacviet.vip.json'), 'utf8'));
const raw = fs.readFileSync(path.join(dir, 'fixtures/sangtacviet.getchapterlist.txt'), 'utf8');

const mod = eval(rule.script);
const ctx = {
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/',
  html: '',
  utils: { cleanText: (t) => String(t || '').replace(/\s+/g, ' ').trim(), sanitize: (h) => h },
  fetch: async (u) => { if (!/getchapterlist/.test(u)) throw new Error('unexpected fetch: ' + u); return raw; },
};

const toc = await mod.extractToC(ctx);
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
A(toc.length === 95, `expected 95 chapters, got ${toc.length}`);
A(toc.every((c) => /^https:\/\/sangtacviet\.vip\/truyen\/qidian\/1\/1049545651\/\d+\/$/.test(c.url)), 'urls absolute + well-formed');
A(toc[0].url === 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909671868/', `first url wrong: ${toc[0].url}`);
A(toc.every((c) => !/vip/i.test(c.title)), 'vip flag leaked into a title');
A(new Set(toc.map((c) => c.url)).size === 95, 'duplicate urls');
console.log(`OK: ${toc.length} chapters, urls absolute, first="${toc[0].title}"`);
