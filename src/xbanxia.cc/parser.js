({
  async extractToC(ctx) {
    const doc = new DOMParser().parseFromString(ctx.html, 'text/html');
    const links = [...doc.querySelectorAll('.book-list > ul > li > a')];
    if (!links.length) throw new Error('xbanxia: missing chapter list: ' + ctx.url);
    return links.map(a => ({
      title: ctx.utils.cleanText(a.textContent),
      url: ctx.utils.resolveUrl(a.getAttribute('href'), ctx.url),
    }));
  },

  async extractChapter(ctx) {
    const doc = new DOMParser().parseFromString(ctx.html, 'text/html');
    const body = doc.querySelector('article #nr1');
    if (!body) throw new Error('xbanxia: missing chapter body: ' + ctx.url);
    body.querySelectorAll('div, script, style, iframe').forEach(el => el.remove());
    body.querySelectorAll('span').forEach(el => {
      if (el.textContent.trim() === '半夏小說，快樂很多') el.remove();
    });
    const html = ctx.utils.sanitize(body.innerHTML.replace(/本作品源自晉江文學城\s*歡迎登陸閱讀更多好作品/g, ''));
    if (!html.replace(/<[^>]*>/g, '').trim()) throw new Error('xbanxia: empty chapter body: ' + ctx.url);
    return html;
  },
})
