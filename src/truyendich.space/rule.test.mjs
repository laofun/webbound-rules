import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const fx = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const site = 'https://truyendich.space';
const bookUrl = `${site}/doc-truyen/co-chan-nhan`;
const api = `${site}/api/novels/co-chan-nhan`;

// Offline API: ToC pages → toc_N.json (default edition) / toc_ai_1.json, chapters → chapter_*.json.
let chapterFixture = 'chapter_1_ai.json';
const fetched = [];
const fetch = async (u) => {
  fetched.push(u);
  if (u === api) return fx('novel.json');
  let m = u.match(/\/chapters\?size=200(&edition_type=\w+)?&page=(\d+)$/);
  if (m) return fx(m[1] && m[2] === '1' ? 'toc_ai_1.json' : `toc_${m[2]}.json`);
  if (/\/chapters\/\d+(\?edition_type=\w+)?$/.test(u)) return fx(chapterFixture);
  throw new Error('unexpected fetch ' + u);
};
const ctx = (url, f = fetch) => createScriptableContext({ html: fx('book.html'), url, config: { ...rule.config, chapter_delay_ms: 0 }, fetch: f });

// 1. url_pattern: book page in every edition, never a chapter.
const re = new RegExp(rule.url_pattern);
for (const u of [bookUrl, `${site}/doc-truyen/ai/co-chan-nhan`, `${site}/doc-truyen/cv/co-chan-nhan/`, `${bookUrl}?tab=chapters`])
  A(re.test(u), `url_pattern must match ${u}`);
for (const u of [`${bookUrl}/chuong-1`, `${site}/doc-truyen/ai/co-chan-nhan/chuong-12`, `${site}/the-loai/tien-hiep`])
  A(!re.test(u), `url_pattern must not match ${u}`);

// 2. ToC, default edition: 13 API pages, 2429 chapters, in order, no dups.
const toc = await parser.extractToC(ctx(bookUrl));
A(toc.length === 2429, `expected 2429 chapters, got ${toc.length}`);
A(toc[0].title === 'Chương 1: Dù Bỏ Mình Ma Tâm Vẫn Không Hối Hận' && toc[0].url === `${bookUrl}/chuong-1`, `bad first: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === 'Chương 2429: Phương Nguyên, Cự Dương Chiến Tinh Tú' && toc.at(-1).url === `${bookUrl}/chuong-2429`, `bad last: ${JSON.stringify(toc.at(-1))}`);
A(new Set(toc.map(c => c.url)).size === toc.length, 'duplicate chapter urls');
A(fetched.length === 13 && fetched.every(u => !u.includes('edition_type')), `default edition: 13 ToC fetches without edition_type, got ${fetched}`);

// 3. Edition picked by URL prefix: edition_type on every API call, prefix kept in chapter URLs.
for (const ed of ['ai', 'cv']) {
  fetched.length = 0;
  const t = await parser.extractToC(ctx(`${site}/doc-truyen/${ed}/co-chan-nhan`));
  A(t.length === 2429 && t[0].url === `${site}/doc-truyen/${ed}/co-chan-nhan/chuong-1`, `${ed}: bad ToC ${JSON.stringify(t[0])}`);
  A(fetched.length === 13 && fetched.every(u => u.includes('edition_type=' + ed)), `${ed}: every ToC fetch needs edition_type=${ed}`);
}
const aiToc = await parser.extractToC(ctx(`${site}/doc-truyen/ai/co-chan-nhan`));
A(aiToc[0].title === 'Chương 1: Thả Người Vong Ma Tâm Vẫn Dứt Khoát', `ai edition must use its own titles, got ${aiToc[0].title}`);

// A failed ToC page must throw, not silently drop 200 chapters.
const flaky = async (u) => (u.endsWith('&page=7') ? '{"detail":"VERIFY_HUMAN"}' : fetch(u));
let threw = false;
try { await parser.extractToC(ctx(bookUrl, flaky)); } catch { threw = true; }
A(threw, 'extractToC must throw when a ToC page fails');

// 4. Metadata from the API.
const meta = await parser.extractMetadata(ctx(`${site}/doc-truyen/ai/co-chan-nhan`));
A(meta.title === 'Cổ Chân Nhân' && meta.author === 'Cổ Chân Nhân', `bad meta: ${JSON.stringify(meta)}`);
A(meta.cover === `${site}/anh-bia/co-chan-nhan-491.webp?v=1777727962` && meta.status === 'Đang ra' && meta.genres === 'Tiên Hiệp, Kiếm Hiệp', `bad meta: ${JSON.stringify(meta)}`);
A(meta.description.includes('ma đầu'), 'bad meta description');

// 5. Chapter: right edition requested, plain text → <p>, warning line dropped.
fetched.length = 0;
const chUrl = `${site}/doc-truyen/ai/co-chan-nhan/chuong-1`;
const body = await parser.extractChapter(ctx(chUrl));
A(fetched.length === 1 && fetched[0] === `${api}/chapters/1?edition_type=ai`, `bad chapter fetch: ${fetched}`);
A(body.startsWith('<p>“Phương Nguyên, ngoan ngoãn giao ra Xuân Thu Thiền'), `bad chapter start: ${body.slice(0, 80)}`);
A(body.endsWith('<p>Nhưng hắn lại vô cùng rõ ràng, đây tuyệt đối không phải mộng.</p>'), 'chapter end missing');
A(body.split('<p>').length > 50 && !/<br|<p><\/p>|<script/i.test(body), 'AI <br> text must become clean <p> paragraphs');

// The site injects an anti-reader-mode line into the body; it must be dropped.
const warn = JSON.parse(fx('chapter_1_ai.json'));
warn.content = 'Dòng một.<br><br>Xin vui lòng tắt chế độ đọc để xem nội dung chương.<br><br>Dòng hai.';
const warnBody = await parser.extractChapter(ctx(chUrl, async () => JSON.stringify(warn)));
A(warnBody === '<p>Dòng một.</p>\n<p>Dòng hai.</p>', `warning line leaked: ${warnBody}`);

// The anti-burst pause comes from config and defaults to 4s when unset.
A(rule.config.chapter_delay_ms >= 3000, 'rule must pause >=3s per chapter');

// 6. Verification challenge / empty body must throw with a hint, not return ''.
for (const f of ['chapter_verify_now.json', 'chapter_verify_human.json']) {
  chapterFixture = f;
  let err = null;
  try { await parser.extractChapter(ctx(chUrl)); } catch (e) { err = e; }
  A(err && /verification/.test(err.message), `${f} must throw a verification error`);
}

console.log('OK: truyendich.space — 2429-chapter ToC over 13 API pages, ai/cv edition by URL, API metadata, verify challenge throws');
