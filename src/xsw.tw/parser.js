({
  // Desktop info page (/book/<id>.html): return null so the selectors apply. Mobile
  // info page (m.xsw.tw/<id>/): the selectors miss there (its div.intro is the
  // 小說簡介 label), so read it here. Both intros are the same cut-off text.
  extractMetadata: async ({ html, url, utils }) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const box = doc.querySelector('.block_txt2');
    if (!box) return null;
    const field = (k) => (Array.from(box.querySelectorAll('p'), (p) => utils.cleanText(p.textContent)).find((t) => t.startsWith(k)) || '').slice(k.length);
    const src = doc.querySelector('.block_img2 img')?.getAttribute('src');
    return {
      title: utils.cleanText(box.querySelector('h2')?.textContent),
      author: field('作者：'),
      cover: src ? utils.resolveUrl(src, url) : '',
      description: utils.cleanText(doc.querySelector('.intro_info')?.textContent).replace(/^關於[^：]*：\s*/, ''),
      status: field('狀態：'),
      genres: field('分類：'),
    };
  },

  // The desktop TOC (/book/<id>/) lists every chapter on one page and is fresher
  // than the 20-per-page mobile list; the chapter ids are the same on both. Emit
  // mobile chapter URLs: desktop chapter pages carry only the first half of the text.
  extractToC: async ({ url, fetch, utils }) => {
    const id = (/xsw\.tw\/(?:book\/)?(\d+)/.exec(url) || [])[1];
    if (!id) throw new Error('xsw.tw: no book id in ' + url);
    const tocUrl = 'https://www.xsw.tw/book/' + id + '/';
    const doc = new DOMParser().parseFromString(await fetch(tocUrl), 'text/html');
    const toc = Array.from(doc.querySelectorAll('.liebiao ul li a'), (a) => ({
      title: utils.cleanText(a.textContent),
      url: utils.resolveUrl(a.getAttribute('href'), tocUrl).replace(/^https?:\/\/(?:www\.)?xsw\.tw\/book\/(\d+)\/(\d+)\.html$/, 'https://m.xsw.tw/$1/$2.html'),
    }));
    if (!toc.length) throw new Error('xsw.tw: empty chapter list at ' + tocUrl);
    return toc;
  },

  // Mobile chapter page: plain text in an id="nr1" element (tag randomised per
  // request: div, nr1, chapter...) up to the 章節報錯 <center>. Read the raw string.
  extractChapter: async ({ html, url, fetch }) => {
    // A desktop chapter URL (saved by rule versions before 1.1.0): the page holds
    // half the text, so read the mobile page with the same ids instead.
    const d = /xsw\.tw\/book\/(\d+)\/(\d+)\.html/.exec(url);
    if (d) { url = 'https://m.xsw.tw/' + d[1] + '/' + d[2] + '.html'; html = await fetch(url); }
    // Lines are plain text: drop any tag (stray <content>) and space entities.
    const norm = (s) => s.replace(/<[^>]*>/g, '').replace(/&(nbsp|ensp|emsp|thinsp);|&#12288;/g, ' ').replace(/\s+/g, ' ').trim();
    const lines = (h) => ((/id="?nr1"?[^>]*>([\s\S]*?)<center/i.exec(h) || [])[1] || '').split(/<br\s*\/?>/i).map(norm).filter(Boolean);
    let paras = lines(html);
    // Force Hybrid passes Chrome's DOM, where a <table>/<select> wrapper pushes the
    // text out of place or eats the <br>s: re-read the raw page (one extra fetch for
    // the one-line 該章節缺失txt文件 placeholder too).
    if (paras.length < 2) paras = lines(await fetch(url));
    if (!paras.length) throw new Error('xsw.tw: no chapter text at ' + url);
    // Line 1 often repeats the title, with "/" where the title has "_": compare letters only.
    const key = (s) => s.replace(/[^\p{L}\p{N}]/gu, '');
    const title = /id="?nr_title"?[^>]*>([^<]*)</i.exec(html);
    if (title && key(paras[0]) === key(title[1]) && paras.length > 1) paras.shift();
    return paras.map((p) => '<p>' + p + '</p>').join('');
  },
})
