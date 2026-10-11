({
  // Book page → /dir (全部章节). The dir page also has a "latest chapters" list;
  // only `ul.all` is the full, ordered ToC.
  async extractToC(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    const pick = (d) => utils.qsa('ul.one.two-700.three-900.all > li a', d);

    let base = ctx.url;
    let doc = P(ctx.html);
    let anchors = pick(doc);
    if (!anchors.length) {
      const more = utils.qs('.chaplist div.more > a', doc);
      base = more ? utils.resolveUrl(more.getAttribute('href'), ctx.url) : ctx.url.replace(/\/+$/, '') + '/dir';
      doc = P(await ctx.fetch(base));
      anchors = pick(doc);
    }

    const chapters = [];
    const seen = new Set();
    for (const a of anchors) {
      const title = utils.cleanText(a.textContent);
      const url = utils.resolveUrl(a.getAttribute('href'), base);
      if (!title || seen.has(url)) continue;
      seen.add(url);
      chapters.push({ title, url });
    }
    if (!chapters.length) throw new Error('novel543: no chapters found at ' + base);
    return chapters;
  },

  async extractMetadata(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    let doc = P(ctx.html);
    if (!utils.qs('.media-content.info > .title', doc)) doc = P(await ctx.fetch(ctx.url));
    const img = utils.qs('.cover.full img', doc);
    const src = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const intro = utils.qs('.intro.is-hidden-mobile', doc);
    return {
      title: utils.text('.media-content.info > .title', doc),
      author: utils.text('#detail > div.media > div.media-content.info > p.meta span.author', doc),
      cover: src ? utils.resolveUrl(src, ctx.url) : '',
      description: intro ? utils.sanitize(intro.innerHTML) : '',
      genres: utils.qsa('p.meta > span > a', doc).map((a) => utils.cleanText(a.textContent)).filter(Boolean).join(', '),
    };
  },

  // Chapters are split into parts: <cid>.html is "(1/N)", then <cid>_2.html …
  // <cid>_N.html. The ToC links only part 1; N comes from the h1.
  async extractChapter(ctx) {
    const { utils } = ctx;
    const P = (h) => new DOMParser().parseFromString(h || '', 'text/html');
    const body = (doc, url) => {
      const el = utils.qs('.chapter-content .content', doc) || utils.qs('.chapter-content', doc);
      if (!el) throw new Error('novel543: chapter content not found at ' + url);
      utils.remove(el, '.gadBlock, .adBlock, script, style, ins, iframe, h1');
      // Site notice injected at the end of every part.
      utils.qsa('p, div', el).filter((n) => n.textContent.includes('溫馨提示')).forEach((n) => n.remove());
      return el.innerHTML;
    };

    let doc = P(ctx.html);
    if (!utils.qs('.chapter-content', doc)) doc = P(await ctx.fetch(ctx.url));
    const total = Math.min(parseInt((utils.text('.chapter-content h1', doc).match(/\(\s*1\s*\/\s*(\d+)\s*\)/) || [])[1] || '1', 10), 20);
    const parts = [body(doc, ctx.url)];
    for (let k = 2; k <= total; k++) {
      const url = ctx.url.replace(/\.html$/, `_${k}.html`);
      parts.push(body(P(await ctx.fetch(url)), url));
    }
    return utils.sanitize(parts.join('\n'));
  },
})
