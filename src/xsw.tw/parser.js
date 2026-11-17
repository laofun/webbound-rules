({
  // The info page is UTF-8 but its <meta> says big5; extension builds before the
  // decodeHtml fix trust the meta, so it arrives garbled. Then read title/author
  // from the TOC page (real Big5); else return null so the selectors apply.
  extractMetadata: async ({ html, url, fetch, utils }) => {
    const parse = (h) => new DOMParser().parseFromString(h, 'text/html');
    const info = parse(html);
    if ((info.querySelector('h1.f20h em')?.textContent || '').includes('作者：')) return null;
    const href = info.querySelector('span.btopt a')?.getAttribute('href');
    if (!href) return null;
    const toc = parse(await fetch(utils.resolveUrl(href, url)));
    const title = utils.cleanText(toc.querySelector('.infot h1')?.textContent);
    if (!title) return null;
    const src = info.querySelector('div.box_intro div.pic img')?.getAttribute('src');
    return {
      title,
      author: utils.cleanText(toc.querySelector('.infot span')?.textContent).replace(/^作者：/, ''),
      cover: src ? utils.resolveUrl(src, url) : '',
      description: '',
      status: '',
      genres: '',
    };
  },

  // Start URL is the info page (/book/<id>.html); the chapter list is on /book/<id>/.
  extractToC: async ({ html, url, fetch, utils }) => {
    const parse = (h) => new DOMParser().parseFromString(h, 'text/html');
    let doc = parse(html);
    if (!doc.querySelector('.liebiao')) {
      const href = doc.querySelector('span.btopt a')?.getAttribute('href');
      if (!href) throw new Error('xsw.tw: no "開始閱讀" link on ' + url);
      url = utils.resolveUrl(href, url);
      doc = parse(await fetch(url));
    }
    const toc = Array.from(doc.querySelectorAll('.liebiao ul li a'), (a) => ({
      title: utils.cleanText(a.textContent),
      url: utils.resolveUrl(a.getAttribute('href'), url),
    }));
    if (!toc.length) throw new Error('xsw.tw: empty chapter list at ' + url);
    return toc;
  },

  // Two page kinds. Encrypted: AES-128-CBC ciphertext in var encrypted/key/iv (hex
  // key + iv, PKCS7) that page JS decrypts into #new_content. Plain: the text sits in
  // an id=content name="content" element (tag randomised per request: p, chapter,
  // article...) up to the 章節報錯 <center>. Read the raw string, not the DOM: a <p>
  // wrapper is closed by the inner <P>, so the element itself comes out empty.
  extractChapter: async ({ html, url, fetch }) => {
    const pick = (name) => (new RegExp('var\\s+' + name + '\\s*=\\s*"([^"]+)"').exec(html) || [])[1];
    const enc = pick('encrypted'), key = pick('key'), iv = pick('iv');
    let text;
    if (enc && key && iv) {
      const subtle = globalThis.crypto && globalThis.crypto.subtle;
      if (!subtle) throw new Error('xsw.tw: crypto.subtle is unavailable in the sandbox');
      const hex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
      const k = await subtle.importKey('raw', hex(key), 'AES-CBC', false, ['decrypt']);
      text = new TextDecoder().decode(await subtle.decrypt({ name: 'AES-CBC', iv: hex(iv) }, k, Uint8Array.from(atob(enc), (c) => c.charCodeAt(0))));
    } else {
      const inline = (h) => (/name="content"[^>]*>\s*(?:<\/p>\s*)?<p\b[^>]*>([\s\S]*?)<center/i.exec(h) || [])[1];
      // Force Hybrid passes Chrome's DOM, where a <table>/<tbody>/<select> wrapper has
      // pushed the text out of place: re-read the raw page (in-tab fetch) then.
      text = inline(html);
      if (text === undefined) text = inline(await fetch(url));
      if (text === undefined) throw new Error('xsw.tw: no chapter text at ' + url);
    }
    // Lines are plain text: drop any tag (wrapper <P>, stray <content>) and space entities.
    const norm = (s) => s.replace(/<[^>]*>/g, '').replace(/&(nbsp|ensp|emsp|thinsp);|&#12288;/g, ' ').replace(/\s+/g, ' ').trim();
    const paras = text.split(/<br\s*\/?>/i).map(norm).filter(Boolean);
    const h2 = /<h2>([^<]*)<\/h2>/i.exec(html);
    if (h2 && paras[0] === norm(h2[1])) paras.shift();
    if (!paras.length) throw new Error('xsw.tw: empty chapter at ' + url);
    return paras.map((p) => '<p>' + p + '</p>').join('');
  },
})
