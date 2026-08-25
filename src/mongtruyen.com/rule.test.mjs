import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/mongtruyen.com.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();

const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const tocHtml = readFileSync(path.join(here, 'fixtures/toc_p1.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const chapterApiJson = readFileSync(path.join(here, 'fixtures/chapter_api.json'), 'utf8');

const bookUrl = 'https://mongtruyen.com/khi-nao-trang-sang.html';
const chapterUrl = 'https://mongtruyen.com/khi-nao-trang-sang.html?chuong=1';

// 1. Assert url_pattern
const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book page');
A(!pattern.test('https://mongtruyen.com/dang-nhap.html'), 'url_pattern must reject dang-nhap page');
A(!pattern.test('https://mongtruyen.com/hoan-thanh.html'), 'url_pattern must reject hoan-thanh page');

// 2. Assert Metadata
const bookCtx = createScriptableContext({
  html: bookHtml,
  url: bookUrl,
  config: rule.config,
  fetch: async (u) => {
    if (u.includes('load-chapters.php')) return tocHtml;
    return bookHtml;
  },
});

const metadata = await parser.extractMetadata(bookCtx);
A(metadata.title === 'Khi Nào Trăng Sáng', `wrong title: ${metadata.title}`);
A(metadata.author === 'Từ Thụ', `wrong author: ${metadata.author}`);
A(metadata.cover.startsWith('https://mongtruyen.com/'), `wrong cover URL: ${metadata.cover}`);
A(metadata.status.includes('Thành') || metadata.status.includes('Thành'), `wrong status: ${metadata.status}`);
A(metadata.genres.includes('Ngôn tình'), `wrong genres: ${metadata.genres}`);
A(metadata.description.length > 50, `description too short: ${metadata.description}`);

// 3. Assert ToC
const chapters = await parser.extractToC(bookCtx);
A(Array.isArray(chapters), 'extractToC must return array');
A(chapters.length >= 20, `expected at least 20 chapters, got ${chapters.length}`);
A(chapters[0].title.includes('Chương 1'), `first chapter title wrong: ${chapters[0].title}`);
A(chapters[0].url.startsWith('https://mongtruyen.com/'), `first chapter URL not absolute: ${chapters[0].url}`);
A(!chapters[0].url.includes('mongtruyen.com//'), `double slash in chapter URL: ${chapters[0].url}`);

// 4. Assert Chapter Content
const chapterCtx = createScriptableContext({
  html: chapterHtml,
  url: chapterUrl,
  config: rule.config,
  fetch: async (u) => {
    if (u.includes('load-chapter-content.php')) return chapterApiJson;
    return chapterHtml;
  },
});

const body = await parser.extractChapter(chapterCtx);
A(typeof body === 'string' && body.length > 200, `chapter body too short (${body?.length ?? 0})`);
A(body.includes('Một tiếng “Ầm” vang vọng'), 'expected chapter content text missing');
A(!body.includes('<script'), 'script tag not stripped from chapter');
A(!body.includes('copy-protection-overlay'), 'overlay not stripped');

console.log('OK: mongtruyen.com rule test passed');
