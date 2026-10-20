Captured 2026-10-18 with same-origin `fetch` from the Chrome console of a
www.youshu.me tab that had passed Cloudflare and was logged in (UTF-8, HTTP 200).
`npm run fixture` cannot fetch youshu.me: Cloudflare blocks non-browser clients.
book-notfound.html is /book/999999999 (HTTP 200, blank page titled 优书网).
Edited after capture: every user avatar URL (`/files/system/avatar/<n>/<id>.jpg`) is
replaced by the site's fallback `/images/noavatars.jpg`, and the capturing account's
name in the page header is replaced by `viewer`, and the session `jieqi_token` (vote links and the review form) is zeroed, and the logged-in user id in book-page `if(<uid>)` handlers is replaced by `if(1)`. Reviewer names, ids and review text
are kept as published on the site.
book-newhot-p1.html and books-allvisit-p1.html back the max-ID survey in docs/superpowers/research/2026-10-19-youshu-field-mapping.md (newest ID 328064 on the new-hot list, 6331 all-visit pages) and are not used by tests.
