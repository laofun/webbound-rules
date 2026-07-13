# WebBound Official Rules

Site-parsing rules for the **WebBound / NovelPacker** Chrome extension. The extension
crawls novel sites and packages their chapters into EPUB; each rule teaches it how to
read one site (where the title, chapter list, and chapter body live). This is the
**official** repository, seeded into the extension by default.

## Structure

```
webbound-rules/
├── repo.json                 # index — lists every rule in this repo
├── rules/
│   └── <domain>.json         # one rule per site
└── docs/
    └── RULE_SYSTEM.md        # full rule-authoring reference (generic + scriptable)
```

## Use it in the extension

Marketplace → **Repository URL** → paste the raw `repo.json` URL:

```
https://raw.githubusercontent.com/laofun/webbound-rules/main/repo.json
```

(If this is your default repo, it is already added on first run.)

## Add or update a rule

1. **Write the rule** at `rules/<domain>.json`. Start by copying an existing rule
   (`rules/novel543.com.json`) and read [`docs/RULE_SYSTEM.md`](docs/RULE_SYSTEM.md) —
   it is the single source of truth, and §9 has an AI Prompt Pack that generates a
   working rule from a page's HTML.
2. **Register it** in `repo.json` under `sources[]`:

   ```json
   {
     "id": "example.com",
     "name": "Example Site",
     "domain": "example.com",
     "rule_url": "./rules/example.com.json",
     "version": "1.0.0",
     "author": "WebBound",
     "description": "Short one-liner shown on the browse card.",
     "icon": "📖",
     "language": "zh",
     "featured": true
   }
   ```

3. **Keep versions in sync.** The `version` in the `repo.json` entry MUST equal the
   `version` inside the rule file. Bump **both** (semver) on every change — installed
   users only see an _Update_ when the version rises.
4. **Validate** before committing:

   ```bash
   node -e '
   const fs=require("fs");
   const repo=JSON.parse(fs.readFileSync("repo.json"));
   for(const s of repo.sources){
     const f=s.rule_url.replace(/^\.\//,"");
     if(!fs.existsSync(f)) throw new Error("missing "+f);
     const r=JSON.parse(fs.readFileSync(f));
     if(r.version!==s.version) throw new Error("version drift: "+s.id+" repo="+s.version+" rule="+r.version);
   }
   console.log("ok:", repo.sources.length, "rule(s)");'
   ```

5. Open a **Pull Request**.

## `repo.json` source fields

| Field         | Required | Notes                                                                                                                                        |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Stable identifier, usually the domain.                                                                                                       |
| `name`        | yes      | Display name on the browse card.                                                                                                             |
| `domain`      | yes      | Hostname without `www.`.                                                                                                                     |
| `rule_url`    | yes      | Path to the rule file. Relative (`./rules/x.json`) is resolved against this `repo.json`'s URL — keep it relative so the repo stays portable. |
| `version`     | yes      | Semver. Must match the rule file's `version`.                                                                                                |
| `author`      | no       | Credit shown on the card.                                                                                                                    |
| `description` | no       | One-line summary for the card.                                                                                                               |
| `icon`        | no       | Emoji or icon URL.                                                                                                                           |
| `language`    | no       | `en` \| `vi` \| `zh` \| `all`.                                                                                                               |
| `featured`    | no       | Pin to the Featured section.                                                                                                                 |

## Rule format in one paragraph

Two engines. **`generic`** — CSS selectors, fetched with plain HTTP (fast, works for
most static sites). **`scriptable`** — a small JS object run in a sandbox
(`extractToC` / `extractChapter` / `extractMetadata`), for JS-heavy or
Cloudflare-protected sites. `rules/novel543.com.json` is a scriptable example: it
routes through a real browser tab, so the user must enable **Force Hybrid Mode** in
the extension settings for it to work. Full contract, selector power-features, and the
sandbox `ctx`/`utils` API are documented in [`docs/RULE_SYSTEM.md`](docs/RULE_SYSTEM.md).

## Versioning

Semver per rule. Bump `repo_meta.version` in `repo.json` whenever the set of rules
changes so downstream mirrors can detect a refresh.
