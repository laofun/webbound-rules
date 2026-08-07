import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/metruyenchuvn.org.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');

const ctx = createScriptableContext({
  html: chapterHtml,
  url: 'https://metruyenchuvn.org/ta-ve-ra-phu-luc-tat-bi-cam-dung/chuong-59-PgVSpFPaEEOQ',
  config: rule.config,
  fetch: async () => chapterHtml,
});

const body = await parser.extractChapter(ctx);

A(typeof body === 'string' && body.length > 200, `chapter body too short (${body?.length ?? 0})`);
A(body.includes('Sáng sớm, Giang Thành'), 'expected text missing from chapter body');
A(!body.includes('<script'), 'script tag not stripped');
A(!body.includes('download-book'), 'download-book button not stripped');

console.log('OK: metruyenchuvn.org chapter test passed');
