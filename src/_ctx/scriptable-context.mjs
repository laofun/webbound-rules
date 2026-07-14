// Shared scriptable-parser context factory — SOURCE OF TRUTH.
// Self-contained ESM: no imports. Depends only on globals `document`,
// `DOMParser`, `setTimeout`, `URL`, and an injected `fetch`, so the identical
// file runs in the sandbox iframe AND in node (rules-repo tests vendor a
// byte-identical copy). Bump SCRIPTABLE_CTX_VERSION on any behavior change and
// re-vendor into ../webbound-rules/src/_ctx/scriptable-context.mjs.
export const SCRIPTABLE_CTX_VERSION = "1.0.0";

export function createScriptableContext({ html, url, config, fetch }) {
    const utils = {
        // --- Async Helpers ---
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        // --- DOM Helpers ---
        qs: (selector, root = document) => root.querySelector(selector),

        qsa: (selector, root = document) => Array.from(root.querySelectorAll(selector)),

        text: (selector, root = document) => {
            const el = root.querySelector(selector);
            return el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '';
        },

        html: (selector, root = document) => {
            const el = root.querySelector(selector);
            return el ? el.innerHTML : '';
        },

        attr: (selector, attr, root = document) => {
            const el = root.querySelector(selector);
            return el ? el.getAttribute(attr) : '';
        },

        remove: (root, selector) => {
            root.querySelectorAll(selector).forEach(el => el.remove());
        },

        // --- Content Helpers ---
        cleanText: (text) => (text || '').replace(/\s+/g, ' ').trim(),

        decodeEntities: (text) => {
            const txt = document.createElement('textarea');
            txt.innerHTML = text;
            return txt.value;
        },

        sanitize: (content) => {
            if (!content) return '';
            let sanitized = String(content);

            // 1. Close self-closing tags (XHTML compatibility)
            sanitized = sanitized
                .replace(/<br\s*>/gi, '<br/>')
                .replace(/<hr\s*>/gi, '<hr/>')
                .replace(/<img([^>]+)>/gi, (match, attrs) => match.endsWith('/>') ? match : `<img${attrs}/>`);

            // 2. Remove scripts, iframes, styles, comments
            sanitized = sanitized.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
            sanitized = sanitized.replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gim, "");
            sanitized = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "");
            sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");

            // 3. Remove inline styles and event handlers
            sanitized = sanitized.replace(/\s(style|on\w+)="[^"]*"/gi, '');

            return sanitized;
        },

        formatParagraphs: (text) => {
            const lines = (text || '').split(/\n+/);
            const paragraphs = [];

            lines.forEach((line) => {
                const cleanLine = line.replace(/\s+/g, ' ').trim();
                if (!cleanLine) return;

                // Heuristic: If paragraph is too long (> 500 chars), split by sentences
                if (cleanLine.length > 500) {
                    const sentences = cleanLine.split(/([.!?]["”']?(?:\s+|$))/);
                    let currentChunk = "";
                    for (let i = 0; i < sentences.length; i += 2) {
                        const sentence = sentences[i];
                        const delimiter = sentences[i + 1] || "";
                        currentChunk += sentence + delimiter;

                        if (currentChunk.length > 300) {
                            paragraphs.push(currentChunk.trim());
                            currentChunk = "";
                        }
                    }
                    if (currentChunk) paragraphs.push(currentChunk.trim());
                } else {
                    paragraphs.push(cleanLine);
                }
            });
            return paragraphs;
        },

        // --- URL Helpers ---
        resolveUrl: (url, base) => {
            try {
                return new URL(url, base).toString();
            } catch {
                return url;
            }
        },

        // --- Network Helpers (close over injected fetch) ---
        fetchJson: async (url) => {
            const text = await fetch(url);
            return JSON.parse(text);
        },

        batchFetch: async (urls, concurrency = 5) => {
            const results = [];
            for (let i = 0; i < urls.length; i += concurrency) {
                const chunk = urls.slice(i, i + concurrency);
                const chunkResults = await Promise.all(chunk.map(u => fetch(u).catch(_ => null)));
                results.push(...chunkResults);
            }
            return results;
        }
    };

    const context = {
        html: html || '',
        url: url || '',
        config: config || {},
        fetch,
        utils,
        cheerio: null
    };

    // DOM query helper over the page HTML (users may also use standard DOM API).
    context.$ = (selector) => {
        const doc = new DOMParser().parseFromString(context.html, 'text/html');
        return doc.querySelectorAll(selector);
    };

    return context;
}
