// Unit checks for the dataset ctx harness: ctx shape, origin-relative fetch,
// script loading, and the engine's run-result rules.
import './dom-env.mjs';
import { loadDatasetScript, createDatasetContext, checkRunResult, runTask } from './dataset-context.mjs';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const rejects = (fn, re, m) => {
  try { fn(); } catch (e) { A(re.test(e.message), `${m}: wrong error — ${e.message}`); return; }
  A(false, `${m}: expected a throw`);
};

const seen = [];
const fetch = async (url) => { seen.push(url); return url.endsWith('.json') ? '{"ok":1}' : '<html><body>ok</body></html>'; };
const ctx = createDatasetContext({ origin: 'https://ex.com', config: { rate_limit_ms: 5 }, params: { from: 1 }, task: { key: 'k' }, fetch });
A(ctx.html === '' && ctx.url === 'https://ex.com', 'ctx: html must be empty and url the origin');
A(ctx.params.from === 1 && ctx.task.key === 'k' && ctx.config.rate_limit_ms === 5, 'ctx: params/task/config not passed through');
A(typeof ctx.utils.qs === 'function' && typeof ctx.$ === 'function', 'ctx: utils and $ missing');
await ctx.fetch('/book/1');
const json = await ctx.utils.fetchJson('/x.json');
A(seen[0] === 'https://ex.com/book/1' && seen[1] === 'https://ex.com/x.json' && json.ok === 1, 'fetch: relative URLs (ctx.fetch and utils helpers) must resolve against origin — ' + seen);
const empty = createDatasetContext({ origin: 'https://ex.com', fetch });
A(JSON.stringify(empty.params) === '{}' && empty.task === null, 'ctx: params defaults to {} and task to null');

rejects(() => loadDatasetScript('({ async seed() { return []; } })'), /seed and run/, 'load: missing run');
A(typeof loadDatasetScript(' ({ seed() {}, run() {} }) ').run === 'function', 'load: valid script');

rejects(() => checkRunResult({ status: 'done' }), /Invalid run status/, 'result: bad status');
rejects(() => checkRunResult({ status: 'ok', records: [{ table: 'a/b', key: '1', data: {} }] }), /Invalid record/, 'result: bad table');
rejects(() => checkRunResult({ status: 'ok', records: [{ table: 'books', key: 1, data: {} }] }), /Invalid record/, 'result: numeric key');
rejects(() => checkRunResult({ status: 'ok', tasks: [{ id: 1 }] }), /Invalid task/, 'result: task without key');
rejects(() => checkRunResult({ status: 'ok', records: {} }), /must be arrays/, 'result: records not an array');
rejects(() => checkRunResult({ status: 'wall' }), /wall needs a message/, 'result: wall without message');
A(checkRunResult({ status: 'ok', records: [{ table: 'reviews.v2', key: '9', data: {} }], tasks: [{ key: 't' }] }).status === 'ok', 'result: valid ok');
A(checkRunResult({ status: 'notfound' }).status === 'notfound', 'result: notfound without records');

const script = '({ async seed() { return []; }, async run(ctx, task) { const html = await ctx.fetch("/p/" + task.id); return { status: "ok", records: [{ table: "t", key: String(task.id), data: { len: html.length, from: ctx.params.from } }] }; } })';
const r = await runTask(script, { origin: 'https://ex.com', params: { from: 3 }, task: { key: 'p:7', id: 7 }, fetch });
A(r.records[0].key === '7' && r.records[0].data.from === 3 && seen.at(-1) === 'https://ex.com/p/7', 'runTask: run with task, params and origin fetch');

console.log('OK: dataset ctx — shape, origin fetch, script loading, run-result checks');
