import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const bookUrl = 'https://www.jpxs123.com/tongren/10982.html';
const chapterUrl = 'https://www.jpxs123.com/tongren/10982/1.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject chapter pages');
A(!pattern.test(new URL('/author/1/x.html', bookUrl).toString()), 'url_pattern must reject author pages');

const { document: book } = parseHTML(bookHtml);
const text = (selector) => (book.querySelector(selector)?.textContent || '').trim();
A(text(rule.selectors.title) === '基金會：我徵召諸天次元鬥蛐蛐(1-235)', `title selector failed, got: "${text(rule.selectors.title)}"`);
A(text(rule.selectors.author) === 'Clef', `author selector failed, got: "${text(rule.selectors.author)}"`);
A(book.querySelector(rule.selectors.cover)?.getAttribute('src')?.endsWith('88dda52c3b1d615945942ccafbcee1e0.jpg'), 'cover selector failed');
A(text(rule.selectors.desc).includes('楚雲穿越SCP基金會世界'), 'description selector failed');

const tocLinks = Array.from(book.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 386, `expected 386 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));
A(toc[0].title === '第1节', 'first chapter title is wrong');
A(toc[0].url === chapterUrl, 'first chapter url is wrong');
A(toc[toc.length - 1].title === '第386节', 'last chapter title is wrong');
A(toc[toc.length - 1].url === new URL('386.html', chapterUrl).toString(), 'last chapter url is wrong');
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const cleanText = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(cleanText.includes('這條小蜥蜴就交給你了'), 'chapter text was dropped');
A(cleanText.includes('蔓延向了整個崩鐵宇宙'), 'chapter tail was dropped');
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');
A(!cleanText.includes('下一章'), 'page navigation leaked into chapter content');

console.log('OK: jpxs123.com generic rule — metadata, ToC, and clean chapter content');
