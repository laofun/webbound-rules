// Runnable check for sangtacviet.vip's extractChapter: `node tests/sangtacviet.chapter.test.mjs`.
// Feeds the rule's ctx.fetch a REAL readchapter body and asserts extractChapter
// returns clean prose: <i> translation tokens flattened, site notices and the
// "click to load" placeholder gone. No DOMParser needed — extractChapter is pure
// string/regex, so we eval the shipped rule directly.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = path.dirname(fileURLToPath(import.meta.url));
const rule = JSON.parse(fs.readFileSync(path.join(dir, '../rules/sangtacviet.vip.json'), 'utf8'));
const body = fs.readFileSync(path.join(dir, 'fixtures/sangtacviet.readchapter.json'), 'utf8');

const mod = eval(rule.script);
let fetched = '';
const ctx = {
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909778338/',
  html: '',
  utils: { cleanText: (t) => String(t || '').replace(/\s+/g, ' ').trim(), sanitize: (h) => h },
  fetch: async (u) => { fetched = u; return body; },
};

const out = await mod.extractChapter(ctx);
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
A(/[?&]sajax=readchapter\b/.test(fetched), `wrong readchapter url: ${fetched}`);
A(/[?&]c=909778338\b/.test(fetched), `chapter id missing from url: ${fetched}`);
A(out.length > 150, `content too short: ${out.length}`);
A(!/<i[\s>]/.test(out), 'translation <i> tokens not flattened');
A(!/Nhấp vào để tải/.test(out), 'placeholder leaked into content');
A(!/@Bạn đang đọc bản lưu/.test(out), 'system notice not stripped');
A(/Một tháng sau/.test(out), 'real prose missing');
console.log(`OK: extractChapter ${out.length} chars clean, fetched=${fetched.split('?')[1]}`);
