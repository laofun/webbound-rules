// Chapter anchor: built script + real vendored ctx must fetch readchapter and
// return clean body text with <i> tokens flattened and boilerplate stripped.
import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/sangtacviet.vip.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();
const readRaw = readFileSync(path.join(here, 'fixtures/readchapter.json'), 'utf8');

let fetchedUrl = '';
const ctx = createScriptableContext({
  html: '',
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909778338/',
  config: rule.config,
  fetch: async (u) => { fetchedUrl = u; return readRaw; },
});

const out = await parser.extractChapter(ctx);

A(/sajax=readchapter/.test(fetchedUrl), 'chapter fetch URL missing sajax=readchapter — ' + fetchedUrl);
A(/c=909778338/.test(fetchedUrl), 'chapter fetch URL missing c=909778338 — ' + fetchedUrl);
A(out.length > 150, `chapter body too short (${out.length} chars)`);
A(!/<i[\s>]/.test(out), '<i> tokens were not flattened');
A(!out.includes('Nhấp vào để tải'), 'download-prompt boilerplate not stripped');
A(!out.includes('@Bạn đang đọc bản lưu'), '@-notice boilerplate not stripped');
A(out.includes('Một tháng sau'), 'expected body text "Một tháng sau" missing');

console.log('OK: sangtacviet chapter — readchapter fetched, body cleaned, tokens flattened');
