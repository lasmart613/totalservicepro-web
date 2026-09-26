# Public service manuals, notes, and troubleshooting

Indexable pages live in `web/lib/seo/publicContent.ts`. Routes, static params, and sitemap `lastmod` values are derived from the arrays in that file. The signed-in manuals library stays at `/manuals` and is not used to render these pages.

`Disallow: /manuals` in robots.txt also blocks `/manuals/...`. Do not add public pages under `/manuals`. Use `/service-manuals`, `/blog`, and `/troubleshooting`.

## Add a page

1. Open `web/lib/seo/publicContent.ts`.
2. Append one object:
   - Service or operator manual landing: `SERVICE_MANUALS`
   - Field note: `BLOG_POSTS`
   - Troubleshooting guide: `TROUBLESHOOTING_GUIDES`
3. Fill `title`, `description`, slug fields (`makeSlug` + `modelSlug`, or `slug`), `updatedAt` (`YYYY-MM-DD`), and original body blocks.
4. For a manual, copy the catalog `title` exactly. Set `documentType` to `Service` or `Operator`. Link related notes with site paths such as `/calculators`.
5. Do not add `storage_path`, signed URLs, PDF links, page images, or copied OEM text or tables.

A new make appears on `/service-manuals` and `/service-manuals/[make]` from the manual entry. No new route file is required.

`app/sitemap.ts` builds `/sitemap.xml` from `sitemapEntries()` in `web/lib/seo.ts`. That list calls:

- `serviceManualSitemapPaths()` — `/service-manuals`, `/service-manuals/[make]`, `/service-manuals/[make]/[model]`
- `blogSitemapPaths()` — `/blog` and `/blog/[slug]`
- `troubleshootingSitemapPaths()` — `/troubleshooting` and `/troubleshooting/[slug]`

Those functions read this module. Do not add a static `public/sitemap.xml` beside `app/sitemap.ts`. Do not put these paths under `/manuals`.

From `web/`:

```bash
npm test
```

`lib/seo/publicContent.test.ts` checks titles, descriptions, slugs, word counts, and that entries do not contain storage paths or PDF URLs.
