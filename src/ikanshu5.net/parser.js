({
  // ToC is paginated 50 chapters/page at /indexlist/<id>/, /indexlist/<id>/2/, ...
  // Page 1's <select id="indexselect"> lists every page, so fetch them in
  // parallel instead of walking 下一页 one by one.
  async extractToC(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    const id = (ctx.url.match(/\/(?:book|indexlist)\/(\d+)/) || [])[1];
    if (!id) throw new Error('ikanshu5: no book id in ' + ctx.url);
    const first = utils.resolveUrl(`/indexlist/${id}/`, ctx.url);

    const firstDoc = P(await ctx.fetch(first));
    const pageUrls = [];
    for (const opt of utils.qsa('#indexselect option', firstDoc)) {
      const u = utils.resolveUrl(opt.getAttribute('value'), first);
      if (u !== first && !pageUrls.includes(u)) pageUrls.push(u);
    }

    // ponytail: concurrency 10 keeps a ~150-page ToC (≈7500 chapters) inside the
    // sandbox's 30s per-call timeout; bigger books need a resumable ToC in the extension.
    const rest = await utils.batchFetch(pageUrls, 10);
    const docs = [firstDoc];
    rest.forEach((html, i) => {
      const doc = P(html);
      if (!doc.querySelector('#content_1 a[rel="chapter"]')) throw new Error('ikanshu5: ToC page failed to load: ' + pageUrls[i]);
      docs.push(doc);
    });

    const chapters = [];
    const seen = new Set();
    for (const doc of docs) {
      for (const a of utils.qsa('#content_1 a[rel="chapter"]', doc)) {
        const url = utils.resolveUrl(a.getAttribute('href'), first);
        const title = utils.cleanText(a.textContent);
        if (!title || seen.has(url)) continue;
        seen.add(url);
        chapters.push({ title, url });
      }
    }
    return chapters;
  },

  // Every chapter is split into sub-pages <cid>.html, <cid>_2.html, ...; the
  // rel="next" link stays on <cid>_N.html until the last part, then points at
  // the next chapter.
  async extractChapter(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    const cid = (ctx.url.match(/\/(\d+)(?:_\d+)?\.html/) || [])[1];
    const sameChapter = new RegExp(`/${cid}_\\d+\\.html$`);
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    let url = ctx.url;
    let doc = P(ctx.html);
    if (!doc.querySelector('#booktxt')) doc = P(await ctx.fetch(url));

    const paras = [];
    for (let part = 1; part <= 20; part++) {
      if (!doc.querySelector('#booktxt')) throw new Error('ikanshu5: chapter part failed to load: ' + url);
      for (const p of utils.qsa('#booktxt p', doc)) {
        const text = utils.cleanText(p.textContent);
        if (!text || /^本章未完/.test(text) || /^[\p{P}\s]+$/u.test(text)) continue;
        paras.push(`<p>${esc(text)}</p>`);
      }
      const next = utils.attr('a[rel="next"]', 'href', doc) || '';
      if (!cid || !sameChapter.test(next)) break;
      url = utils.resolveUrl(next, url);
      doc = P(await ctx.fetch(url));
    }
    return paras.join('\n');
  },

  async extractMetadata(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    let doc = P(ctx.html);
    if (!doc.querySelector('meta[property="og:novel:book_name"]')) {
      const id = (ctx.url.match(/\/(?:book|indexlist)\/(\d+)/) || [])[1];
      if (!id) return null;
      doc = P(await ctx.fetch(utils.resolveUrl(`/book/${id}/`, ctx.url)));
    }
    const og = (p) => utils.cleanText(utils.attr(`meta[property="og:${p}"]`, 'content', doc) || '');
    const title = og('novel:book_name') || utils.text('h1', doc);
    if (!title) return null;
    return {
      title,
      author: og('novel:author'),
      cover: og('image'),
      description: og('description'),
      status: og('novel:status'),
      genres: og('novel:category'),
    };
  },
})
