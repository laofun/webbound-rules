({
  // The book page lists only the first 80 chapters. The full list is what its
  // 查看完整章节目录 button loads: POST /novel/html bid=<id> → bare <li><a> items
  // (an unknown id gives an empty body).
  extractToC: async ({ url, fetch, utils }) => {
    const id = (/ixdzs8\.com\/read\/(\d+)/.exec(url) || [])[1];
    if (!id) throw new Error('ixdzs8.com: no book id in ' + url);
    const html = await fetch(utils.resolveUrl('/novel/html', url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'bid=' + id,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const toc = Array.from(doc.querySelectorAll('a[href*="/read/' + id + '/"]'), (a) => ({
      title: utils.cleanText(a.textContent),
      url: utils.resolveUrl(a.getAttribute('href'), url),
    }));
    if (!toc.length) throw new Error('ixdzs8.com: empty chapter list for book ' + id);
    return toc;
  },

  // One page per chapter; the text is the <p>s of article.page-content section.
  extractChapter: async ({ html, url }) => {
    const sec = new DOMParser().parseFromString(html, 'text/html').querySelector('article.page-content section');
    const paras = sec ? Array.from(sec.querySelectorAll('p')).filter((p) => p.textContent.trim()).map((p) => p.outerHTML) : [];
    if (!paras.length) throw new Error('ixdzs8.com: no chapter text at ' + url);
    return paras.join('');
  },
})
