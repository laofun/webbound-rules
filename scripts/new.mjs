// Scaffold a new rule folder.  node scripts/new.mjs <domain> [--generic]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const PARSER_TEMPLATE = `({
  // Return the chapter list: [{ title, url }, ...]. Use ctx.fetch for AJAX ToCs.
  async extractToC(ctx) {
    return ctx.utils.qsa('a').map(a => ({
      title: ctx.utils.cleanText(a.textContent || ''),
      url: ctx.utils.resolveUrl(a.getAttribute('href'), ctx.url),
    }));
  },
  // Return cleaned chapter HTML/text. Fetch the real body via ctx.fetch if needed.
  async extractChapter(ctx) {
    return ctx.utils.sanitize(ctx.utils.html('body'));
  },
  // Optional: return { title, author, cover, description }.
  async extractMetadata(ctx) {
    return { title: '', author: '', cover: '', description: '' };
  },
})
`;

export function scaffold(destRoot, domain, { generic = false } = {}) {
  const dir = path.join(destRoot, 'src', domain);
  if (existsSync(dir)) throw new Error(`src/${domain} already exists`);
  mkdirSync(path.join(dir, 'fixtures'), { recursive: true });

  const rule = {
    domain,
    url_pattern: domain.replace(/\./g, '\\.') + '/',
    parser_type: generic ? 'generic' : 'scriptable',
    selectors: generic
      ? { title: '', author: '', cover: '', desc: '', toc: { list_container: '', item: '' }, chapter: { content: '', remove: [] } }
      : { chapter: { content: '', remove: [] } },
    config: { rate_limit_ms: 1500 },
    version: '1.0.0',
    author: 'WebBound',
    language: '',
    description: '',
    marketplace: { name: domain, icon: '📘', featured: false },
  };
  writeFileSync(path.join(dir, 'rule.json'), JSON.stringify(rule, null, 2) + '\n');
  writeFileSync(path.join(dir, 'samples.json'), JSON.stringify({ book_url: '', chapter_url: '' }, null, 2) + '\n');
  if (!generic) writeFileSync(path.join(dir, 'parser.js'), PARSER_TEMPLATE);
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const generic = args.includes('--generic');
  const domain = args.find(a => !a.startsWith('--'));
  if (!domain) { console.error('usage: node scripts/new.mjs <domain> [--generic]'); process.exit(1); }
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  try { scaffold(root, domain, { generic }); }
  catch (e) { console.error(e.message); process.exit(1); }
  console.log(`scaffolded src/${domain}/ (${generic ? 'generic' : 'scriptable'})`);
  console.log(`next: fill rule.json + ${generic ? 'selectors' : 'parser.js'}, add fixtures + a *.test.mjs, then \`npm run build\``);
}
