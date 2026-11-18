import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { extractMetadata, htmlToText } from '../_ctx/generic-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const fx = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const S = 'https://ixdzs8.com/read/';
const bookUrl = S + '586712/';
const calls = [];
const fetch = async (u, init) => { calls.push([u, init?.method, init?.body]); if (u === 'https://ixdzs8.com/novel/html') return fx('toc.html'); throw new Error('unexpected fetch ' + u); };
const ctx = (html, url, f = fetch) => createScriptableContext({ html, url, config: rule.config, fetch: f });

// 1. url_pattern: the book page, not a chapter.
const re = new RegExp(rule.url_pattern);
A(re.test(bookUrl) && re.test(S + '586712') && re.test(bookUrl + '?x=1'), 'pattern should match the book page');
A(!re.test(S + '586712/p1.html') && !re.test('https://ixdzs8.com/sort/7/'), 'pattern should not match a chapter or a list page');

// 2. ToC: the page shows 80 chapters; the full 760 come from POST /novel/html.
A(new DOMParser().parseFromString(fx('book.html'), 'text/html').querySelectorAll(rule.selectors.toc.item).length === 80, 'book page should list 80');
const toc = await parser.extractToC(ctx(fx('book.html'), bookUrl));
A(toc.length === 760, `expected 760 chapters, got ${toc.length}`);
A(toc[0].title === '第1章 她该清醒了' && toc[0].url === S + '586712/p1.html', `bad first: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === '第760章 还有情分在' && toc.at(-1).url === S + '586712/p760.html', `bad last: ${JSON.stringify(toc.at(-1))}`);
A(calls.length === 1 && calls[0][1] === 'POST' && calls[0][2] === 'bid=586712', `should POST bid once: ${JSON.stringify(calls)}`);
A(await rejects(parser.extractToC(ctx('', 'https://ixdzs8.com/'))), 'extractToC must throw without a book id');
A(await rejects(parser.extractToC(ctx(fx('book.html'), bookUrl, async () => ''))), 'extractToC must throw on an empty list (unknown id)');
A(await rejects(parser.extractToC(ctx(fx('book.html'), bookUrl, async () => '<html>403 Forbidden</html>'))), 'extractToC must throw on a 403 page');

// 3. Chapter: the <p>s of article.page-content section, nothing else.
const body = await parser.extractChapter(ctx(fx('chapter.html'), S + '586712/p1.html'));
const ps = body.match(/<p>/g) || [];
A(ps.length === 104 && body.startsWith('<p>容辞抵达a国机场时，已经晚上九点多了。</p>') && body.endsWith('吩咐司机：“去机场。”</p>'), `bad chapter: ${body.slice(0, 60)}`);
A(!/<h2|chapter-meta|<script|<section|下一章/.test(body), 'chapter should hold only the text paragraphs');
A(await rejects(parser.extractChapter(ctx('<html>403 Forbidden</html>', S + '586712/p1.html'))), 'extractChapter must throw without text');

// 4. Metadata: generic selectors on the book page.
const m = extractMetadata(new DOMParser().parseFromString(fx('book.html'), 'text/html'), rule.selectors);
A(m.title === '封总，太太想跟你离婚很久了' && m.author === '云中觅' && m.status === '连载中'
  && m.cover === 'https://img22.ixdzs.com/11/10/11108102c155f4605826d9154412e366.jpg'
  && m.genres === '豪门总裁, 现代言情, 虐文, 先婚后爱, 隐婚, 追夫', `bad meta: ${JSON.stringify(m)}`);
A(htmlToText(m.description).startsWith('结婚七年，封庭深待她冷漠如冰'), `bad desc: ${htmlToText(m.description).slice(0, 40)}`);

console.log('OK: ixdzs8.com — 760-chapter ToC via POST /novel/html, clean chapter text, metadata');
