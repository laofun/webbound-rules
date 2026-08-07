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
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const listchapPage2 = readFileSync(path.join(here, 'fixtures/listchap_page2.json'), 'utf8');

const ctx = createScriptableContext({
  html: bookHtml,
  url: 'https://metruyenchuvn.org/ta-ve-ra-phu-luc-tat-bi-cam-dung',
  config: rule.config,
  fetch: async (u) => {
    if (u.includes('listchap')) return listchapPage2;
    return bookHtml;
  },
});

const chapters = await parser.extractToC(ctx);

A(Array.isArray(chapters), 'extractToC must return array');
A(chapters.length >= 100, `expected at least 100 chapters, got ${chapters.length}`);
A(chapters[0].title.includes('Chương'), 'first chapter title missing Chương');
A(chapters[0].url.startsWith('https://metruyenchuvn.org/'), 'first chapter URL not absolute');

const metadata = await parser.extractMetadata(ctx);
A(metadata.title === 'Ta Vẽ Ra Phù Lục Tất Bị Cấm Dùng', `wrong title: ${metadata.title}`);
A(metadata.author === 'An Tĩnh Phủng Tràng', `wrong author: ${metadata.author}`);
A(metadata.cover.startsWith('https://metruyenchuvn.org/'), `wrong cover URL: ${metadata.cover}`);

console.log('OK: metruyenchuvn.org toc + metadata test passed');
