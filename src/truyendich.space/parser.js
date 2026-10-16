({
  // Everything comes from the JSON API at /api/novels/<slug>. A book has up to
  // three editions and the user picks one by the URL they start from, exactly as
  // on the site: /doc-truyen/<slug> (site default, usually "dịch"),
  // /doc-truyen/ai/<slug> (AI) or /doc-truyen/cv/<slug> (convert). The prefix is
  // sent as ?edition_type= and kept in every chapter URL.
  // ToC: /chapters?page=N&size=200 (200 is the server cap), fetched in parallel.
  async extractToC(ctx) {
    const { utils } = ctx;
    const m = ctx.url.match(/\/doc-truyen\/(?:(ai|cv)\/)?([^/?#]+)/);
    if (!m) throw new Error('truyendich: no novel slug in ' + ctx.url);
    const [, ed, slug] = m;
    const api = utils.resolveUrl(`/api/novels/${slug}/chapters?size=200${ed ? '&edition_type=' + ed : ''}&page=`, ctx.url);
    const parse = (raw, u) => {
      let j;
      try { j = JSON.parse(raw); } catch { j = null; }
      if (!j || !Array.isArray(j.items)) throw new Error('truyendich: ToC page failed to load: ' + u);
      return j;
    };

    const first = parse(await ctx.fetch(api + 1), api + 1);
    const total = Number(first.total) || 0;
    const urls = [];
    for (let p = 2; p <= Math.ceil(total / 200); p++) urls.push(api + p);
    const rest = await utils.batchFetch(urls, 5);
    const pages = [first, ...rest.map((raw, i) => parse(raw, urls[i]))];

    const chapters = [];
    const seen = new Set();
    for (const page of pages) {
      for (const c of page.items) {
        const n = c?.chapter_number;
        if (n == null || seen.has(n)) continue;
        seen.add(n);
        const title = utils.cleanText(c.title || '');
        chapters.push({
          title: `Chương ${n}${title ? ': ' + title : ''}`,
          url: utils.resolveUrl(`/doc-truyen/${ed ? ed + '/' : ''}${slug}/chuong-${n}`, ctx.url),
        });
      }
    }
    if (chapters.length !== total) throw new Error(`truyendich: ToC has ${chapters.length} of ${total} chapters`);
    return chapters;
  },

  // The web chapter page is a JS shell; the text comes from
  // /api/novels/<slug>/chapters/<n>. The server degrades per-client trust on
  // bursts and then answers VERIFY_HUMAN / trust_challenge=verify_now with empty
  // content until a Turnstile check passes in the browser.
  async extractChapter(ctx) {
    const { utils } = ctx;
    const m = ctx.url.match(/\/doc-truyen\/(?:(ai|cv)\/)?([^/?#]+)\/chuong-(\d+)/);
    if (!m) throw new Error('truyendich: not a chapter url: ' + ctx.url);
    const [, ed, slug, n] = m;
    const u = utils.resolveUrl(`/api/novels/${slug}/chapters/${n}${ed ? '?edition_type=' + ed : ''}`, ctx.url);
    // The extension runs scriptable chapters one at a time but back to back, so
    // rate_limit_ms alone leaves almost no gap; pause here to stay under the
    // site's burst detector. ponytail: fixed delay, tune config.chapter_delay_ms.
    await utils.sleep(ctx.config?.chapter_delay_ms ?? 4000);
    let d;
    try { d = JSON.parse(await ctx.fetch(u)); } catch { d = null; }
    if (!d) throw new Error('truyendich: chapter failed to load: ' + u);
    if (d.detail === 'VERIFY_HUMAN' || d.trust_challenge === 'verify_now')
      throw new Error('truyendich: site asks for human verification — open truyendich.space in the browser, pass the check, enable Force Hybrid Mode and retry');
    if (String(d.status).toUpperCase() === 'FAILED') throw new Error('truyendich: chapter is marked FAILED on the site: ' + u);

    // The site injects an anti-reader-mode line into the body; drop it everywhere.
    const text = String(d.content || '')
      .replace(/[\s　]*Xin vui lòng tắt chế độ[^<\n]*?nội dung chương\.?(?:\s*<br\s*\/?>)?/gi, '')
      .trim();
    if (!text) throw new Error('truyendich: empty chapter: ' + u);
    if (/<p[\s>]|<div[\s>]/i.test(text)) return utils.sanitize(text);
    // Plain text (convert/dịch) or <br>-separated text (AI) → one <p> per line.
    const plain = /<br\s*\/?>/i.test(text) ? utils.decodeEntities(text.replace(/<br\s*\/?>/gi, '\n')) : text;
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return plain.split(/\n+/).map(l => utils.cleanText(l)).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('\n');
  },

  async extractMetadata(ctx) {
    const { utils } = ctx;
    const slug = (ctx.url.match(/\/doc-truyen\/(?:ai\/|cv\/)?([^/?#]+)/) || [])[1];
    if (!slug) return null;
    const d = await utils.fetchJson(utils.resolveUrl(`/api/novels/${slug}`, ctx.url)).catch(() => null);
    if (!d?.title) return null;
    const status = String(d.status || '').toLowerCase();
    return {
      title: utils.cleanText(d.title),
      author: utils.cleanText(d.author || ''),
      cover: d.image_url ? utils.resolveUrl(d.image_url, ctx.url) : '',
      description: d.description ? utils.sanitize(d.description) : '',
      status: ['completed', 'complete', 'full'].includes(status) ? 'Hoàn thành' : status ? 'Đang ra' : '',
      genres: (d.categories || []).map(c => c?.name).filter(Boolean).join(', '),
    };
  },
})
