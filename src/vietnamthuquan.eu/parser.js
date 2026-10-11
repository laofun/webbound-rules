({
  async extractToC(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');

    if (!html || !doc.querySelector('#vntqTocList')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }

    const chapters = [];
    const seen = new Set();

    const tocAnchors = Array.from(doc.querySelectorAll('#vntqTocList a.vntq-toc-item, #vntqTocList a'));
    for (const a of tocAnchors) {
      const href = a.getAttribute('href');
      const title = ctx.utils.cleanText(a.textContent || '');
      if (href && href.includes('/chuong-') && title) {
        const absoluteUrl = ctx.utils.resolveUrl(href, ctx.url);
        if (!seen.has(absoluteUrl)) {
          seen.add(absoluteUrl);
          chapters.push({ title, url: absoluteUrl });
        }
      }
    }

    const theodoiBox = doc.querySelector('.vntq-theodoi-box');
    const tuaId = theodoiBox?.getAttribute('data-id')
      || (html.match(/tuaId\s*=\s*(\d+)/) || [])[1]
      || (ctx.url.match(/-(\d+)\/?(?:chuong-\d+)?$/) || [])[1];

    let slugTua = '';
    const duongdan = theodoiBox?.getAttribute('data-duongdan') || '';
    const duongdanMatch = duongdan.match(/\/TacPham\/([^/]+)/);
    if (duongdanMatch) {
      slugTua = duongdanMatch[1];
    } else {
      const urlSlugMatch = ctx.url.match(/\/TacPham\/([^/]+)/);
      if (urlSlugMatch) slugTua = urlSlugMatch[1];
    }

    let maxPage = 1;
    const options = doc.querySelectorAll('#vntqTocSelect option');
    options.forEach((opt) => {
      const val = parseInt(opt.getAttribute('value') || opt.textContent, 10);
      if (!isNaN(val) && val > maxPage) maxPage = val;
    });

    if (tuaId && slugTua && maxPage > 1) {
      for (let p = 2; p <= maxPage; p++) {
        try {
          const ajaxUrl = ctx.utils.resolveUrl(`/api/tacpham/get-mucluc?tuaId=${tuaId}&page=${p}&pageSize=100`, ctx.url);
          const raw = await ctx.fetch(ajaxUrl);
          let json = null;
          try {
            json = typeof raw === 'string' ? JSON.parse(raw) : raw;
          } catch (e) {}

          if (!json || !json.success || !Array.isArray(json.chapters)) throw new Error('bad JSON response');
          for (const ch of json.chapters) {
            const chapterUrl = ctx.utils.resolveUrl(`/TacPham/${slugTua}/chuong-${ch.chuongId}`, ctx.url);
            if (!seen.has(chapterUrl)) {
              seen.add(chapterUrl);
              chapters.push({
                title: ctx.utils.cleanText(ch.title || ''),
                url: chapterUrl,
              });
            }
          }
        } catch (err) {
          throw new Error(`vietnamthuquan: chapter list page ${p} failed: ${err.message}`);
        }
      }
    }

    if (!chapters.length) throw new Error('vietnamthuquan: no chapters found at ' + ctx.url);
    return chapters;
  },

  async extractChapter(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || !doc.querySelector('#vntqTextContent, .vntq-text-content')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const el = doc.querySelector('#vntqTextContent') || doc.querySelector('.vntq-text-content');
    if (!el) throw new Error('vietnamthuquan: chapter body not found at ' + ctx.url);
    const clone = el.cloneNode(true);
    clone.querySelectorAll('script, style, ins, iframe, .ads, .advertisement, blockquote, .vntq-toolbar, .vntq-nav-bar').forEach((n) => n.remove());
    return ctx.utils.sanitize(clone.innerHTML);
  },

  async extractMetadata(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || !doc.querySelector('.vntq-reader-title')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const t = (sel) => {
      const el = doc.querySelector(sel);
      return el ? ctx.utils.cleanText(el.textContent || '') : '';
    };

    const theodoi = doc.querySelector('.vntq-theodoi-box');
    const title = theodoi?.getAttribute('data-tieude')
      || t('.vntq-reader-title')
      || t('h1');

    const author = t('.vntq-author-top a') || t('.vntq-author-top');

    const img = doc.querySelector('.vntq-large-cover-box img');
    const coverSrc = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : (theodoi?.getAttribute('data-anhbia') || '');

    const chuongso = t('.chuongso_a');
    let desc = '';
    if (chuongso.toLowerCase().includes('giới thiệu') || chuongso.toLowerCase().includes('gioi thieu')) {
      const descEl = doc.querySelector('#vntqTextContent, .vntq-text-content');
      if (descEl) {
        const clone = descEl.cloneNode(true);
        clone.querySelectorAll('script, style, ins, iframe, .ads, blockquote').forEach((n) => n.remove());
        desc = ctx.utils.sanitize(clone.innerHTML);
      }
    }

    let genres = '';
    const worksH3 = doc.querySelector('.vntq-author-works h3');
    if (worksH3) {
      const gm = worksH3.textContent.match(/\((?:cùng\s+thể\s+loại\s+)?([^)]+)\)/i);
      if (gm) genres = ctx.utils.cleanText(gm[1]);
    }

    return {
      title,
      author,
      cover: coverSrc ? ctx.utils.resolveUrl(coverSrc, ctx.url) : '',
      description: desc,
      status: '',
      genres,
    };
  },
})
