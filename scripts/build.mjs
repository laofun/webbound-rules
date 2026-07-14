// Build: src/ → rules/*.json + repo.json. Zero deps.
//   node scripts/build.mjs          → write generated files
//   node scripts/build.mjs --check  → verify committed files are up to date (CI)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSrcDir = path.join(root, 'src');
const rulesDir = path.join(root, 'rules');

// canonical published-rule key order: domain, url_pattern?, parser_type,
// selectors, script?, config, version, author, language, description
function buildRule(meta, script) {
  const rule = { domain: meta.domain };
  if (meta.url_pattern !== undefined) rule.url_pattern = meta.url_pattern;
  rule.parser_type = meta.parser_type;
  rule.selectors = meta.selectors;
  if (script !== null) rule.script = script;
  rule.config = meta.config;
  rule.version = meta.version;
  rule.author = meta.author;
  rule.language = meta.language;
  rule.description = meta.description;
  return rule;
}

// canonical repo.json source-entry key order
function buildSource(meta) {
  const m = meta.marketplace || {};
  return {
    id: meta.domain,
    name: m.name ?? meta.domain,
    domain: meta.domain,
    rule_url: './rules/' + meta.domain + '.json',
    version: meta.version,
    author: meta.author,
    description: m.description ?? meta.description,
    icon: m.icon ?? '',
    language: meta.language,
    featured: m.featured ?? false,
  };
}

function domainFolders(srcDir) {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_ctx')
    .map(d => d.name)
    .filter(name => existsSync(path.join(srcDir, name, 'rule.json')));
}

// pure: src → { ruleFiles, repoJson }. Throws with a precise message on any
// validation failure.
export function generate(srcDir = defaultSrcDir) {
  const repoMeta = JSON.parse(readFileSync(path.join(srcDir, 'repo.meta.json'), 'utf8'));
  const ruleFiles = new Map();
  const sources = [];

  for (const folder of domainFolders(srcDir)) {
    const meta = JSON.parse(readFileSync(path.join(srcDir, folder, 'rule.json'), 'utf8'));
    const parserPath = path.join(srcDir, folder, 'parser.js');
    const hasParser = existsSync(parserPath);

    if (!meta.domain) throw new Error(`${folder}/rule.json: missing "domain"`);
    if (meta.domain !== folder) throw new Error(`${folder}/rule.json: domain "${meta.domain}" != folder name "${folder}"`);

    let script = null;
    if (meta.parser_type === 'scriptable') {
      if (!hasParser) throw new Error(`${folder}: parser_type "scriptable" requires src/${folder}/parser.js`);
      const text = readFileSync(parserPath, 'utf8').trim();
      let obj;
      try { obj = new Function('return ' + text)(); }
      catch (e) { throw new Error(`${folder}/parser.js: not a valid expression — ${e.message}`); }
      if (typeof obj !== 'object' || obj === null) throw new Error(`${folder}/parser.js: must evaluate to an object ({ ... })`);
      if (typeof obj.extractToC !== 'function' || typeof obj.extractChapter !== 'function')
        throw new Error(`${folder}/parser.js: must define extractToC and extractChapter functions`);
      script = text;
    } else if (hasParser) {
      throw new Error(`${folder}: parser_type "${meta.parser_type}" must NOT have a parser.js`);
    }

    ruleFiles.set(meta.domain, JSON.stringify(buildRule(meta, script), null, 2) + '\n');
    sources.push(buildSource(meta));
  }

  sources.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  const repoJson = JSON.stringify({ repo_meta: repoMeta, sources }, null, 2) + '\n';
  return { ruleFiles, repoJson };
}

function main() {
  const check = process.argv.includes('--check');
  const { ruleFiles, repoJson } = generate();

  if (!check) {
    for (const [domain, text] of ruleFiles) writeFileSync(path.join(rulesDir, domain + '.json'), text);
    writeFileSync(path.join(root, 'repo.json'), repoJson);
    console.log(`built ${ruleFiles.size} rules + repo.json`);
    return;
  }

  const problems = [];
  for (const [domain, text] of ruleFiles) {
    const p = path.join(rulesDir, domain + '.json');
    if (!existsSync(p)) problems.push(`missing rules/${domain}.json`);
    else if (readFileSync(p, 'utf8') !== text) problems.push(`stale rules/${domain}.json`);
  }
  const repoPath = path.join(root, 'repo.json');
  if (!existsSync(repoPath) || readFileSync(repoPath, 'utf8') !== repoJson) problems.push('stale repo.json');
  for (const f of readdirSync(rulesDir)) {
    if (f.endsWith('.json') && !ruleFiles.has(f.slice(0, -5))) problems.push(`orphan rules/${f} (no matching src)`);
  }

  if (problems.length) {
    console.error('check FAILED:');
    for (const p of problems) console.error('  - ' + p);
    console.error('Run `npm run build` and commit the result.');
    process.exit(1);
  }
  console.log('check clean');
}

// Only run the CLI when executed directly, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
