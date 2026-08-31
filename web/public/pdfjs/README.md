# pdf.js (Mozilla)

Vendored pdf.js 3.11.174 viewer + worker for same-origin loading.

Source: https://github.com/mozilla/pdf.js (Apache-2.0)
Built files match cdnjs `pdf.js@3.11.174` (`pdf.min.js`, `pdf.worker.min.js`).

The service-manual viewer must not load these from a third-party CDN
(Netlify CSP `script-src` is `'self'` plus ad hosts).
