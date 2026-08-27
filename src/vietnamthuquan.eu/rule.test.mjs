import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parserSource = readFileSync(path.join(here, 'parser.js'), 'utf8');
const parser = new Function('return ' + parserSource)();

const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const tocPage2Json = readFileSync(path.join(here, 'fixtures/toc_page2.json'), 'utf8');

const bookUrl = 'https://vietnamthuquan.eu/TacPham/tran-van-truong-sinh-31200/';
const chapterUrl = 'https://vietnamthuquan.eu/TacPham/tran-van-truong-sinh-31200/chuong-2';

// 1. url_pattern
const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book page');
A(!pattern.test(chapterUrl), 'url_pattern must not match chapter page');

// 2. extractToC
const tocCtx = createScriptableContext({
  html: bookHtml,
  url: bookUrl,
  config: rule.config,
  fetch: async (u) => {
    if (u.includes('get-mucluc')) return tocPage2Json;
    return bookHtml;
  },
});

const chapters = await parser.extractToC(tocCtx);
A(Array.isArray(chapters), 'extractToC must return array');
A(chapters.length >= 150, `expected at least 150 chapters with page 2 pagination, got ${chapters.length}`);
A(chapters[0].title.toLowerCase().includes('thiệu'), `first chapter title expected to be intro: ${chapters[0].title}`);
A(chapters[0].url === 'https://vietnamthuquan.eu/TacPham/tran-van-truong-sinh-31200/chuong-1', `wrong first chapter URL: ${chapters[0].url}`);
A(chapters[1].title.includes('Chương 1'), `second chapter title expected Chương 1: ${chapters[1].title}`);
A(chapters[1].url === 'https://vietnamthuquan.eu/TacPham/tran-van-truong-sinh-31200/chuong-2', `wrong second chapter URL: ${chapters[1].url}`);

// 3. extractMetadata
const meta = await parser.extractMetadata(tocCtx);
A(meta.title.includes('Trận Vấn Trường Sinh'), `wrong title: ${meta.title}`);
A(meta.author.includes('Quan Hư'), `wrong author: ${meta.author}`);
A(meta.cover.includes('Tr%E1%BA%ADn_V%E1%BA%A5n_Tr%C6%B0%E1%BB%9Dng_Sinh'), `wrong cover: ${meta.cover}`);
A(meta.description.includes('Tu đạo giai tầng sâm nghiêm'), `wrong description: ${meta.description}`);
A(meta.genres.includes('Tiên Hiệp, Tu Chân'), `wrong genres: ${meta.genres}`);

// 4. extractChapter
const chapCtx = createScriptableContext({
  html: chapterHtml,
  url: chapterUrl,
  config: rule.config,
  fetch: async () => chapterHtml,
});

const body = await parser.extractChapter(chapCtx);
A(typeof body === 'string' && body.length > 200, `chapter body too short (${body?.length ?? 0})`);
A(body.includes('Đạo Lịch ngày mùng 10 tháng 9'), 'expected text missing from chapter body');
A(!body.includes('<script'), 'script tag not stripped');
A(!body.includes('vntq-toolbar'), 'vntq-toolbar not stripped');
A(!body.includes('vntq-nav-bar'), 'vntq-nav-bar not stripped');
A(!body.includes('Nguồn: TVE 4U'), 'blockquote uploader info not stripped');

console.log('OK: vietnamthuquan.eu rule test passed');
