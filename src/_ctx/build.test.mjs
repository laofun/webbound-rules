// Unit checks for build.mjs generate(): canonical key order, script inlining,
// marketplace stripping, repo.json mapping + sort, and the 4 validation rejects.
import { generate } from '../../scripts/build.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

// --- happy path: run against the real src/ ---
const { ruleFiles, repoJson } = generate();

const stv = JSON.parse(ruleFiles.get('sangtacviet.vip'));
A(typeof stv.script === 'string' && stv.script.startsWith('({'), 'sangtacviet: script not inlined');
A(stv.marketplace === undefined, 'sangtacviet: marketplace not stripped');
A(JSON.stringify(Object.keys(stv)) === JSON.stringify(
  ['domain','url_pattern','parser_type','selectors','script','config','version','author','language','description']),
  'sangtacviet: wrong key order — ' + Object.keys(stv));

const pia = JSON.parse(ruleFiles.get('piaotia.com'));
A(pia.script === undefined, 'piaotia: generic must not have script');

const n543 = JSON.parse(ruleFiles.get('novel543.com'));
A(n543.url_pattern === undefined, 'novel543: absent url_pattern must be omitted');
A(JSON.stringify(Object.keys(n543)) === JSON.stringify(
  ['domain','parser_type','selectors','script','config','version','author','language','description']),
  'novel543: wrong key order — ' + Object.keys(n543));

const repo = JSON.parse(repoJson);
A(repo.sources.map(s => s.domain).join(',') === 'novel543.com,piaotia.com,sangtacviet.vip',
  'repo.json: sources not sorted by domain');
A(JSON.stringify(Object.keys(repo.sources[0])) === JSON.stringify(
  ['id','name','domain','rule_url','version','author','description','icon','language','featured']),
  'repo.json: wrong source key order — ' + Object.keys(repo.sources[0]));
const stvSrc = repo.sources.find(s => s.domain === 'sangtacviet.vip');
A(stvSrc.rule_url === './rules/sangtacviet.vip.json', 'repo.json: wrong rule_url');
A(stvSrc.name === 'SangTacViet' && stvSrc.icon === '📗' && stvSrc.featured === true,
  'repo.json: marketplace mapping wrong');

// --- validation rejects: synthetic temp src trees ---
// (local helper; distinct from new.mjs's exported scaffold(destRoot, domain, opts))
function makeSrc(domain, rule, parser) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wbbuild-'));
  writeFileSync(path.join(dir, 'repo.meta.json'), JSON.stringify({ name: 'x', version: '1' }));
  mkdirSync(path.join(dir, domain));
  writeFileSync(path.join(dir, domain, 'rule.json'), JSON.stringify(rule));
  if (parser != null) writeFileSync(path.join(dir, domain, 'parser.js'), parser);
  return dir;
}
const base = (parser_type) => ({ domain: 'a.com', parser_type, selectors: {}, config: {}, version: '1', author: 'x', language: 'en', description: 'd' });
const rejects = (fn, re, m) => {
  try { fn(); } catch (e) { A(re.test(e.message), `${m}: wrong error — ${e.message}`); return; }
  A(false, `${m}: expected a throw`);
};

rejects(() => generate(makeSrc('a.com', base('scriptable'), null)), /requires src\/a\.com\/parser\.js/, 'scriptable missing parser.js');
rejects(() => generate(makeSrc('a.com', base('scriptable'), '({ async extractToC(){ return []; } })')), /extractToC and extractChapter/, 'parser missing extractChapter');
rejects(() => generate(makeSrc('a.com', base('generic'), '({})')), /must NOT have a parser\.js/, 'generic with parser.js');
rejects(() => generate(makeSrc('a.com', { ...base('generic'), domain: 'b.com' }, null)), /!= folder name/, 'domain != folder');

console.log('OK: build generate() — outputs canonical, validation rejects the 4 bad configs');
