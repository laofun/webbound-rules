({
  async extractToC(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');

    if (!html || !doc.querySelector('#chapter-list')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}

      if (!doc.querySelector('#chapter-list')) {
        const bookLink = doc.querySelector('.breadcrumbs a[href*="/"]')?.getAttribute('href')
          || doc.querySelector('.current-book a')?.getAttribute('href');
        if (bookLink) {
          const fullBookUrl = ctx.utils.resolveUrl(bookLink, ctx.url);
          try {
            html = await ctx.fetch(fullBookUrl);
            doc = P(html);
          } catch (e) {}
        }
      }
    }

    const getChaptersFromDoc = (d) => {
      const anchors = Array.from(d.querySelectorAll('.book-info-chapter #chapter-list ul li a, #chapter-list ul li a, ul li a'));
      const list = [];
      const seen = new Set();
      for (const a of anchors) {
        const href = a.getAttribute('href');
        const title = ctx.utils.cleanText(a.textContent || '');
        if (href && href.includes('/chuong-') && title) {
          const absoluteUrl = ctx.utils.resolveUrl(href, ctx.url);
          if (!seen.has(absoluteUrl)) {
            seen.add(absoluteUrl);
            list.push({ title, url: absoluteUrl });
          }
        }
      }
      return list;
    };

    const chapters = getChaptersFromDoc(doc);

    const bidInput = doc.querySelector('input[name="bid"]');
    const bid = bidInput?.getAttribute('value')
      || (html.match(/var\s+rid\s*=\s*'(\d+)'/) || [])[1]
      || (html.match(/page\((\d+),/) || [])[1];

    if (bid) {
      let maxPage = 1;
      const pagingLinks = doc.querySelectorAll('.paging a');
      pagingLinks.forEach((a) => {
        const onclick = a.getAttribute('onclick') || '';
        const m = onclick.match(/page\(\d+,\s*(\d+)\)/);
        if (m) {
          const p = parseInt(m[1], 10);
          if (p > maxPage) maxPage = p;
        }
        const text = a.textContent.trim();
        const num = parseInt(text, 10);
        if (!isNaN(num) && num > maxPage) maxPage = num;
      });

      for (let p = 2; p <= maxPage; p++) {
        try {
          const ajaxUrl = ctx.utils.resolveUrl(`/get/listchap/${bid}?page=${p}`, ctx.url);
          const raw = await ctx.fetch(ajaxUrl);
          let htmlData = '';
          try {
            const json = JSON.parse(raw);
            htmlData = json.data || '';
          } catch (e) {
            htmlData = raw;
          }
          if (htmlData) {
            const pageDoc = P(htmlData);
            const pageChapters = getChaptersFromDoc(pageDoc);
            for (const item of pageChapters) {
              if (!chapters.some((c) => c.url === item.url)) {
                chapters.push(item);
              }
            }
          }
        } catch (err) {
          // ignore page fetch errors
        }
      }
    }

    return chapters;
  },

  async extractChapter(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || (!doc.querySelector('.truyen') && !doc.querySelector('#vungdoc'))) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const el = doc.querySelector('.truyen') || doc.querySelector('#vungdoc') || doc.querySelector('.chapter_wrap');
    if (!el) return '';
    el.querySelectorAll('script, style, ins, iframe, .ads, .advertisement, #download-book').forEach((n) => n.remove());
    return ctx.utils.sanitize(el.innerHTML);
  },

  async extractMetadata(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || !doc.querySelector('h1[itemprop="name"]')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const t = (sel) => {
      const el = doc.querySelector(sel);
      return el ? ctx.utils.cleanText(el.textContent || '') : '';
    };
    const img = doc.querySelector('.book-info-pic img');
    const src = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const desc = doc.querySelector('div[itemprop="description"]');
    const genresList = Array.from(doc.querySelectorAll('.li--genres a'))
      .map((a) => ctx.utils.cleanText(a.textContent || ''))
      .filter(Boolean);

    return {
      title: t('h1[itemprop="name"]') || t('.mRightCol h1'),
      author: t('a[itemprop="author"]'),
      cover: src ? ctx.utils.resolveUrl(src, ctx.url) : '',
      description: desc ? ctx.utils.sanitize(desc.innerHTML) : '',
      status: t('.label-status'),
      genres: genresList.join(', '),
    };
  },
})
