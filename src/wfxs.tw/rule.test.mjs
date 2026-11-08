import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractMetadata, htmlToText } from '../_ctx/generic-context.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const tocHtml = readFileSync(path.join(here, 'fixtures/toc.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');

const bookUrl = 'https://wfxs.tw/xiaoshuo/195691/';
const tocPageUrl = 'https://wfxs.tw/booklist/195691.html';
const chapterUrl = 'https://wfxs.tw/xiaoshuo/195691/73771570/';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book info page');
A(pattern.test(tocPageUrl), 'url_pattern must match booklist page');

const { document: book } = parseHTML(bookHtml);
const meta = extractMetadata(book, rule.selectors);
A(meta.title === '廝磨', `title failed, got: "${meta.title}"`);
A(meta.author === '孟宋', `author failed, got: "${meta.author}"`);
A(meta.cover === 'https://img.wfxs.tw/195/195691/195691s.jpg', `cover failed, got: "${meta.cover}"`);
A(htmlToText(meta.description).includes('喬眠來到他房間'), 'description failed');
// desc is innerHTML; cutting after the label inside <p> must not leave a dangling </p>
// (the EPUB intro page embeds this in XHTML).
A(!meta.description.includes('</p>'), `description has a dangling </p>: "…${meta.description.slice(-20)}"`);
A(meta.status === '連載中', `status failed, got: "${meta.status}"`);
A(meta.genres === '都市言情', `genres failed, got: "${meta.genres}"`);

const tocUrlAttr = book.querySelector(rule.selectors.toc.toc_url)?.getAttribute('href');
A(tocUrlAttr === '/booklist/195691.html', 'toc_url selector failed');
const resolvedTocUrl = new URL(tocUrlAttr, bookUrl).toString();
A(resolvedTocUrl === tocPageUrl, 'resolved toc_url mismatch');

const { document: tocDoc } = parseHTML(tocHtml);
const tocLinks = Array.from(tocDoc.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 108, `expected 108 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), tocPageUrl).toString(),
}));

A(toc[0].title === '第1章', 'first chapter title mismatch');
A(toc[0].url === 'https://wfxs.tw/xiaoshuo/195691/73771570/', 'first chapter url mismatch');
A(toc[toc.length - 1].title.includes('110'), 'last chapter title mismatch');
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const cleanText = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(cleanText.includes('飛機在厚積的雲層上方穿梭'), 'chapter text was dropped');
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');

console.log('OK: wfxs.tw generic rule — metadata, ToC redirect, and clean chapter content');
