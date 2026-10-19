// Node twin of the ctx the extension builds for dataset rules
// (NovelPacker-Extension src/apps/sandbox/sandbox.ts: html '', url =
// dataset.origin, plus params and task) and of the checks DatasetRunner's
// normalizeResult applies to run() results. Relative fetch URLs resolve against
// the origin, as the engine's in-tab fetch does. Not covered by the drift check:
// keep it in step with those two files by hand.
import { createScriptableContext } from './scriptable-context.mjs';

const STATUSES = new Set(['ok', 'notfound', 'retry', 'wall']);
const TABLE = /^\w[\w.-]*$/;

export function loadDatasetScript(text) {
  const obj = new Function('return ' + text.trim())();
  if (!obj || typeof obj.seed !== 'function' || typeof obj.run !== 'function') {
    throw new Error('dataset script must define seed and run');
  }
  return obj;
}

export function createDatasetContext({ origin, config = {}, params = {}, task = null, fetch }) {
  const fromOrigin = (url, init) => fetch(new URL(url, origin).toString(), init);
  return { ...createScriptableContext({ html: '', url: origin, config, fetch: fromOrigin }), params, task };
}

export function checkRunResult(result) {
  if (!result || !STATUSES.has(result.status)) throw new Error(`Invalid run status: ${JSON.stringify(result?.status)}`);
  const records = result.records ?? [];
  const tasks = result.tasks ?? [];
  if (!Array.isArray(records) || !Array.isArray(tasks)) throw new Error('run: records and tasks must be arrays');
  for (const r of records) {
    if (!r || typeof r.key !== 'string' || !r.key || typeof r.table !== 'string' || !TABLE.test(r.table)) {
      throw new Error(`Invalid record: ${JSON.stringify(r)?.slice(0, 200)}`);
    }
  }
  for (const t of tasks) {
    if (!t || typeof t.key !== 'string' || !t.key) throw new Error(`Invalid task: ${JSON.stringify(t)?.slice(0, 200)}`);
  }
  if (result.status === 'wall' && !result.message) throw new Error('wall needs a message');
  return result;
}

export async function runTask(script, { origin, config, params, task, fetch }) {
  const rule = loadDatasetScript(script);
  const ctx = createDatasetContext({ origin, config, params, task, fetch });
  return checkRunResult(await rule.run(ctx, task));
}
