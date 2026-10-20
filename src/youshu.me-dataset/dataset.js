({
  loginMessage: 'Login required: open the crawl tab, log in to youshu.me, then Resume.',

  // One task per book ID; review pages are discovered from each book page.
  async seed(ctx) {
    const p = ctx.params || {};
    const from = Number(p.from ?? 1);
    const to = Number(p.to ?? 330000);
    const mode = p.mode ?? 'update';
    const since = String(p.since ?? '2024-07-01');
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to < from) {
      throw new Error(`Invalid book ID range: from=${p.from} to=${p.to}`);
    }
    if (mode !== 'update' && mode !== 'full') throw new Error(`Invalid mode: ${mode}`);
    if (mode === 'update' && !/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/.test(since)) throw new Error(`Invalid since: ${since}`);
    const tasks = [];
    for (let id = from; id <= to; id++) tasks.push({ key: `book:${id}`, kind: 'book', id });
    return tasks;
  },

  async run(ctx, task) {
    const p = ctx.params || {};
    const opts = { mode: p.mode === 'full' ? 'full' : 'update', since: String(p.since ?? ''), reviews: p.reviews !== false };
    if (task.kind === 'book') return this.book(ctx, task, opts);
    if (task.kind === 'reviews') return this.reviews(ctx, task, opts);
    throw new Error(`Unknown task kind: ${task.kind}`);
  },

  async book(ctx, task, opts) {
    const d = this.doc(await ctx.fetch(`/book/${task.id}`));
    if (opts.reviews && !d.querySelector('a[href$="/logout.php"]')) return { status: 'wall', message: this.loginMessage };
    const titleEl = d.querySelector('.divbox.cf.blockn span[style*="font-size:20px"]');
    if (!titleEl) {
      const box = this.text(d.querySelector('#content .msgbox'));
      if (box.includes('不存在')) return { status: 'notfound' };
      return { status: 'retry', message: box || `No book block on /book/${task.id}: ${this.text(d.querySelector('title'))}` };
    }

    const info = {};
    for (const td of d.querySelectorAll('.tabcontent .tabvalue table.hide td')) {
      const t = this.text(td);
      const i = t.indexOf('：');
      if (i > 0) info[t.slice(0, i).replace(/\s+/g, '')] = t.slice(i + 1).trim();
    }

    const histogramArchived = {};
    for (const bar of d.querySelectorAll('#project-desc .book-score-charts .bar-item')) {
      histogramArchived[this.text(bar.querySelector('.bar-name')).replace(/\s+/g, '')] = this.text(bar.querySelector('.bar-rate')).replace(/\s+/g, '');
    }
    const histogramLive = {};
    for (const row of d.querySelectorAll('.star-rating-chart tr')) {
      const m = this.text(row).match(/(\d)\s*星\s*([\d.]+\s*%)/);
      if (m) histogramLive[`${m[1]}星`] = m[2].replace(/\s+/g, '');
    }

    // Newest date among the book page's 最新书评 previews.
    const times = [...d.querySelectorAll('.comment-box .c_tag .c_label')]
      .filter((l) => l.textContent.includes('时间'))
      .map((l) => this.text(l.nextElementSibling))
      .filter(Boolean)
      .sort();
    const latestReviewAt = times.length ? times[times.length - 1] : null;
    const live = d.querySelector('.ratenum');
    const overview = d.querySelector('#project-desc .book-score-overview');

    const book = {
      id: task.id,
      title: this.text(titleEl),
      author: this.text(titleEl.nextElementSibling?.querySelector('a')),
      status: info['连载状态'] ?? null,
      tags: [...d.querySelectorAll('.divbox.cf.blockn a.tag-link')].map((a) => this.text(a)),
      info,
      wordCount: this.num(info['全文字数']),
      updatedAt: info['最后更新'] || null,
      cover: this.abs(d.querySelector('.book-detail-img img')?.getAttribute('src')),
      intro: this.multiline(d.querySelector('.tabcontent .tabvalue:first-child')),
      scoreArchived: this.num(this.text(overview?.querySelector('.score'))),
      scoreArchivedCount: this.num(this.text(overview?.querySelector('.scorer-count'))),
      scoreLive: this.num(this.text(live)),
      scoreLiveCount: this.num(this.text(live?.nextElementSibling)),
      histogramArchived: Object.keys(histogramArchived).length ? histogramArchived : null,
      histogramLive: Object.keys(histogramLive).length ? histogramLive : null,
      latestReviewAt,
    };

    const tasks = [];
    if (opts.reviews && latestReviewAt && (opts.mode === 'full' || latestReviewAt >= opts.since)) {
      tasks.push({ key: `reviews:${task.id}:1`, kind: 'reviews', bookId: task.id, page: 1 });
    }
    return { status: 'ok', records: [{ table: 'books', key: String(task.id), data: book }], tasks };
  },

  async reviews(ctx, task, opts) {
    const d = this.doc(await ctx.fetch(`/reviews/${task.bookId}/${task.page}.html`));
    if ([...d.querySelectorAll('legend')].some((l) => l.textContent.includes('用户登录'))) {
      return { status: 'wall', message: this.loginMessage };
    }
    const cards = [...d.querySelectorAll('#jieqi_page_contents .pb.c_row.cf')];
    if (!cards.length) return { status: 'retry', message: `No reviews on ${task.key}: ${this.text(d.querySelector('title'))}` };

    const records = [];
    let oldest = null;
    for (const card of cards) {
      const rid = Number(card.querySelector('.c_subject a.pop')?.getAttribute('href')?.match(/\/reviewshow\/(\d+)\//)?.[1]);
      const userLink = card.querySelector('a[href*="userpage.php?id="]');
      const userId = Number(userLink?.getAttribute('href')?.match(/[?&]id=(\d+)/)?.[1]);
      if (!rid || !userId) throw new Error(`Unparsable review card on ${task.key}`);
      const meta = {};
      for (const label of card.querySelectorAll('.c_tag .c_label')) {
        meta[this.text(label).replace(/[：:]$/, '')] = this.text(label.nextElementSibling);
      }
      const description = card.querySelector('.c_description');
      const truncated = !!description?.querySelector('a.c_all');
      if (truncated) description.querySelector('a.c_all').remove();
      const content = this.multiline(description).replace(/(?:\.{6,}|…+)$/, '').trim();
      const userName = this.text(userLink.querySelector('p'));
      const review = {
        rid,
        bookId: task.bookId,
        userId,
        userName,
        title: this.text(card.querySelector('.c_subject a.pop')),
        content,
        truncated,
        deleted: content === '本评论已被清空。',
        stars: this.num(card.querySelector('.c_subject .rt [title$="颗星"]')?.getAttribute('title')),
        createdAt: meta['时间'] || null,
        likes: this.num(this.text(card.querySelector('[class^="love-count-"]'))),
        dislikes: this.num(this.text(card.querySelector('[class^="hate-count-"]'))),
        replies: this.num(meta['回复']),
        views: this.num(meta['点击']),
      };
      if (!review.createdAt) throw new Error(`Review ${rid} has no time on ${task.key}`);
      if (oldest === null || review.createdAt < oldest) oldest = review.createdAt;
      records.push({ table: 'reviews', key: String(rid), data: review });
      records.push({
        table: 'users',
        key: String(userId),
        data: {
          id: userId,
          name: userName,
          level: this.text(card.querySelector('.user-level')) || null,
          joinedAt: this.text(card.querySelector('.pop0')).replace('加入', '') || null,
        },
      });
    }

    const stats = d.querySelector('.pages #pagestats');
    let total = 1; // no pager = one page
    if (stats) {
      const m = this.text(stats).match(/^\d+\/(\d+)$/);
      total = m ? Number(m[1]) : 0;
      // 10000 pages = 300k reviews; the largest book seen has 166 pages.
      if (!(total >= 1 && total <= 10000)) throw new Error(`Unparsable #pagestats on ${task.key}: ${this.text(stats)}`);
    }
    const next = (page) => ({ key: `reviews:${task.bookId}:${page}`, kind: 'reviews', bookId: task.bookId, page });
    const tasks = [];
    if (opts.mode === 'full') {
      if (task.page === 1) for (let page = 2; page <= total; page++) tasks.push(next(page));
    } else if (task.page < total && oldest >= opts.since) {
      tasks.push(next(task.page + 1));
    }
    return { status: 'ok', records, tasks };
  },

  doc(html) {
    return new DOMParser().parseFromString(html, 'text/html');
  },

  text(el) {
    return el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '';
  },

  // Text with <br> kept as newlines.
  multiline(el) {
    if (!el) return '';
    const html = el.innerHTML.replace(/<br\s*\/?>[ \t]*\r?\n?/gi, '\n');
    const tmp = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html').querySelector('div');
    return (tmp.textContent || '').split('\n').map((l) => l.trim()).join('\n').trim();
  },

  num(s) {
    const m = String(s ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
    return m ? Number(m[0]) : null;
  },

  abs(url) {
    return url ? new URL(url, 'https://www.youshu.me/').toString() : null;
  },
})
