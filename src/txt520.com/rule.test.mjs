import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { extractMetadata, htmlToText } from '../_ctx/generic-context.mjs';

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
const bookUrl = 'https://www.txt520.com/ds/50426.html';
const chapterUrl = 'https://www.txt520.com/view/22-50426-1.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject section pages');
A(!pattern.test('https://www.txt520.com/e/DownSys/page/22-50426.html'), 'url_pattern must reject the download page');

const { document: book } = parseHTML(bookHtml);
const meta = extractMetadata(book, rule.selectors);
A(meta.title === '1984：從破產川菜館開始', `title selector failed, got: "${meta.title}"`);
A(meta.author === '轻语江湖', `author selector failed, got: "${meta.author}"`);
A(meta.genres === '都市', `genres selector failed, got: "${meta.genres}"`);
A(htmlToText(meta.description).startsWith('又名《川味人間》'), 'description selector failed');

// The site serves the TXT in 1366 sections (第N节), not the 698 real chapters;
// the 線上閱讀 button also links section 1 and must not be counted.
const toc = Array.from(book.querySelectorAll(rule.selectors.toc.item)).map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));
A(toc.length === 1366, `expected 1366 ToC links, got ${toc.length}`);
A(toc[0].title === '第1节' && toc[0].url === chapterUrl, `first section wrong: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === '第1366节', `last section title wrong: "${toc.at(-1).title}"`);
A(toc.at(-1).url === 'https://www.txt520.com/view/22-50426-1366.html', `last section url wrong: "${toc.at(-1).url}"`);
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate section URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const text = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(text.includes('第1章 重生1984'), 'chapter heading was dropped');
A(text.includes('聽說周硯那小子早上救的姑娘'), 'chapter text start was dropped');
A(text.endsWith('他可太懂川菜了。'), `chapter tail was dropped, ends: "${text.slice(-20)}"`);
for (const junk of ['返回目录', '下一节', '推薦閱讀', '上一篇']) {
  A(!text.includes(junk), `page junk "${junk}" leaked into chapter content`);
}
A(!content.querySelector('script, style'), 'script/style leaked into chapter content');

console.log('OK: txt520.com generic rule — metadata, 1366-section ToC, and clean section content');
