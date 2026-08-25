({
  async extractToC(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || (!doc.querySelector('.mdv-san-pham-show-name') && !doc.querySelector('#result-danh-sach-chuong'))) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }

    const chapters = [];
    const seen = new Set();
    const addChaptersFromDoc = (d) => {
      const anchors = Array.from(d.querySelectorAll('#result-danh-sach-chuong a, .mvd-san-pham-show-danh-sach-chuong-item a, .msv-chuong-item a'));
      for (const a of anchors) {
        const href = (a.getAttribute('href') || '').replace('mongtruyen.com//', 'mongtruyen.com/');
        const title = ctx.utils.cleanText(a.textContent || '');
        const fullUrl = ctx.utils.resolveUrl(href, ctx.url);
        if (fullUrl && fullUrl.includes('chuong=') && title && !title.toLowerCase().startsWith('đọc truy') && !seen.has(fullUrl)) {
          seen.add(fullUrl);
          chapters.push({ title, url: fullUrl });
        }
      }
    };

    // First collect any chapters already present in the initial DOM (e.g. Hybrid Mode tab)
    addChaptersFromDoc(doc);

    const idMatch = (html || '').match(/data\.append\(['"]id_truyen['"],\s*['"](\d+)['"]\)/)
      || (html || '').match(/idTruyen\s*=\s*(\d+)/)
      || (html || '').match(/data-mt-id-truyen=['"](\d+)['"]/);
    const tokenMatch = (html || '').match(/data\.append\(['"]pnvn_token['"],\s*['"]([a-zA-Z0-9_-]+)['"]\)/)
      || (html || '').match(/pnvnToken\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/)
      || (html || '').match(/pnvn_token[\x27\x22\s:]+[\x27\x22]([a-zA-Z0-9_-]+)[\x27\x22]/);
    const pagesMatch = (html || '').match(/totalPages\s*=\s*(\d+)/);

    const idTruyen = idMatch ? idMatch[1] : (doc.querySelector('input[name="id_truyen"]')?.getAttribute('value') || '');
    const token = tokenMatch ? tokenMatch[1] : (doc.querySelector('input[name="pnvn_token"]')?.getAttribute('value') || '');
    const totalPages = pagesMatch ? parseInt(pagesMatch[1], 10) : 1;

    if (idTruyen && token) {
      for (let p = 1; p <= totalPages; p++) {
        try {
          const body = 'page=' + p + '&id_truyen=' + idTruyen + '&pnvn_token=' + token;
          const res = await ctx.fetch('https://mongtruyen.com/sources/ajax/load-chapters.php', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'X-Requested-With': 'XMLHttpRequest',
              'Referer': ctx.url
            },
            body: body
          });
          const pageDoc = P(res);
          addChaptersFromDoc(pageDoc);
        } catch (err) {
          // Continue on error
        }
      }
    }
    return chapters;
  },

  async extractChapter(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || !doc.querySelector('#noi_dung_truyen')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const contentEl = doc.querySelector('#noi_dung_truyen');
    if (!contentEl) return '';

    const nonce = contentEl.getAttribute('data-mt-nonce');
    const idTruyen = contentEl.getAttribute('data-mt-id-truyen');
    const idChapter = contentEl.getAttribute('data-mt-id-chapter');

    let token = doc.querySelector('meta[name="pnvn_token"], #pnvn_token')?.getAttribute('content');
    if (!token) {
      const m = (html || '').match(/pnvn_token[\x27\x22\s:]+[\x27\x22]([a-zA-Z0-9_-]+)[\x27\x22]/)
        || (html || '').match(/data\.append\(['"]pnvn_token['"],\s*['"]([a-zA-Z0-9_-]+)['"]\)/)
        || (html || '').match(/pnvnToken\s*=\s*['"]([a-zA-Z0-9_-]+)['"]/);
      token = m ? m[1] : '';
    }

    if (nonce && idTruyen && idChapter && token) {
      const body = 'pnvn_token=' + token + '&id_truyen=' + idTruyen + '&id_chapter=' + idChapter + '&nonce=' + nonce;
      try {
        const raw = await ctx.fetch('https://mongtruyen.com/sources/ajax/load-chapter-content.php', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': ctx.url
          },
          body: body
        });
        let json = null;
        try {
          json = typeof raw === 'object' ? raw : JSON.parse(raw);
        } catch (e) {}
        if (json && json.status === 'success' && json.noi_dung) {
          return ctx.utils.sanitize(json.noi_dung);
        }
      } catch (e) {}
    }

    contentEl.querySelectorAll('script, style, ins, iframe, .ads, .copy-protection-overlay, .mt-hidden-watermark, .anti-copy-tooltip, .mt-chapter-loading').forEach((n) => n.remove());
    return ctx.utils.sanitize(contentEl.innerHTML);
  },

  async extractMetadata(ctx) {
    const P = (h) => new DOMParser().parseFromString(h, 'text/html');
    let html = ctx.html;
    let doc = P(html || '');
    if (!html || !doc.querySelector('.mdv-san-pham-show-name')) {
      try {
        html = await ctx.fetch(ctx.url);
        doc = P(html);
      } catch (e) {}
    }
    const t = (sel) => {
      const el = doc.querySelector(sel);
      return el ? ctx.utils.cleanText(el.textContent || '') : '';
    };
    const img = doc.querySelector('.san-pham-book-item-show-image img');
    const src = img ? (img.getAttribute('src') || img.getAttribute('data-src') || '') : '';
    const desc = doc.querySelector('.mdv-san-pham-show-gioi-thieu-des, .mdv-sps-gioi-thieu-truyen-content');
    if (desc) {
      desc.querySelectorAll('.san-pham-the-loai-bg, .vh-skeleton, button').forEach((el) => el.remove());
    }
    const genres = Array.from(doc.querySelectorAll('.san-pham-the-loai a, .san-pham-the-loai-item a'))
      .map((a) => ctx.utils.cleanText(a.textContent || ''))
      .filter((x) => x && !x.includes('Thể loại') && !x.includes('Xem thêm') && !x.includes('Rút gọn'));

    const statusEl = Array.from(doc.querySelectorAll('.mdv-sps-tac-gia, .mdv-sps-tac-gia-tinh-trang-box div'))
      .find((el) => el.textContent.includes('Tình Trạng') || el.textContent.includes('Tình Trạng'));
    let status = '';
    if (statusEl) {
      status = ctx.utils.cleanText(statusEl.textContent.replace(/Ti[n|̀]nh Tra[̣|n]ng\s*:\s*/i, ''));
    }

    return {
      title: t('.mdv-san-pham-show-name') || t('meta[property="og:title"]@content'),
      author: t('.tac-gia-ten') || t('a[href*="tac-gia"]'),
      cover: src ? ctx.utils.resolveUrl(src, ctx.url) : '',
      description: desc ? ctx.utils.sanitize(desc.innerHTML) : '',
      status: status || 'Hoàn thành',
      genres: genres.join(', '),
    };
  }
})
