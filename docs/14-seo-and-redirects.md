# 14 - SEO and redirects

1.6.0 gives the public side of the site what search engines and AI answer engines read first, and keeps old addresses working when a post's address changes:

- **One source for the site's own address.** Every canonical, share image, schema id, sitemap entry, robots line and `llms.txt` link is built from `NEXT_PUBLIC_SITE_URL`, never from a domain typed into a page.
- **Metadata, schema, sitemap, robots and `llms.txt`**, built from the posts the public can actually read.
- **A switch that keeps a whole deployment out of search** (staging and preview sites).
- **A renamed live post keeps its old address.** The database adds a permanent redirect from the old address to the new one, and points older redirects straight at the new address, so nothing chains (migration 005).
- **No redirect loops, and every chain listed.** The Redirects screen refuses a save or a switch-on that would make a loop, and lists every chain with the one-hop fix.

## Where it lives

| File | What it does |
|---|---|
| `source/lib/seo/site.ts` | `siteConfig()`: the address, name, description and the noindex switch, read from the environment. `canonicalUrl()`, `absoluteUrl()`, `postPath()`, and `isPublicPost()`, which mirrors the public read policy (published, or scheduled and due, and not past its end date). |
| `source/lib/seo/metadata.ts` | `postMetadata()`: a post's title, description, canonical, robots, Open Graph and Twitter card for Next.js `generateMetadata`. |
| `source/lib/seo/json-ld.ts` | Organization, WebSite, BreadcrumbList and BlogPosting schema, and `jsonLdScriptContent()`, which escapes the JSON so no field can close the script tag. |
| `source/lib/seo/sitemap.ts` | `buildSitemap()`, `buildRobots()` and `buildLlmsTxt()`. Pure functions, tested without a server. |
| `source/lib/seo/routes.ts` | `PUBLIC_ROUTES`: the one list of the site's public pages. The sitemap, `llms.txt` and the admin's Sitemap screen all read it. |
| `source/components/JsonLd.tsx` | Renders one `<script type="application/ld+json">` from a server component, so the schema is in the first HTML a crawler reads. |
| `source/app/sitemap.ts`, `source/app/robots.ts`, `source/app/llms.txt/route.ts` | The three files at `/sitemap.xml`, `/robots.txt` and `/llms.txt`. |
| `source/app/blog/[slug]/page.tsx` | An example public post page wired to all of the above and to the staging preview ([docs/10](10-staging-and-approval.md)). Style it as your own; keep the metadata, the schema and the preview branch. |
| `source/supabase/migrations/005_post_address_redirects.sql` | The redirect a renamed live post gets. |
| `source/lib/redirects/chains.ts` | Following redirects hop by hop: chains, loops and the refusal message. |

## Set it up

1. **Set the environment** (`.env.example`, [docs/09](09-environment-and-deploy.md#environment-variables)):

   | Var | What it does |
   |---|---|
   | `NEXT_PUBLIC_SITE_URL` | The public origin, such as `https://www.example.com`. **Required in production:** a production build refuses a missing value or a `localhost` address, so a site never ships canonicals that point at a developer's machine. In development it falls back to `http://localhost:3000`. |
   | `NEXT_PUBLIC_SITE_NAME` | The brand name in titles and schema. Defaults to `Acme`. |
   | `NEXT_PUBLIC_SITE_DESCRIPTION` | One sentence about the site, for `llms.txt` and the WebSite schema. |
   | `NEXT_PUBLIC_NOINDEX` | `1` or `true` keeps the whole deployment out of search: `robots.txt` disallows everything, every post page says `noindex`, the sitemap is empty and `/llms.txt` answers 404. Set it on staging and preview deployments; leave it unset in production. |

2. **Add the site-wide schema to your root layout.** The kit ships no root layout (your site has its own), so add these lines to it:

   ```tsx
   // app/layout.tsx (your site's root layout)
   import type { Metadata } from 'next'
   import JsonLd from '@/components/JsonLd'
   import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/json-ld'
   import { siteConfig } from '@/lib/seo/site'

   const site = siteConfig()

   export const metadata: Metadata = {
     metadataBase: new URL(site.url),
     title: { default: site.name, template: `%s | ${site.name}` },
     description: site.description,
     ...(site.noindex ? { robots: { index: false, follow: false } } : {}),
   }

   export default function RootLayout({ children }: { children: React.ReactNode }) {
     return (
       <html lang="en">
         <body>
           <JsonLd data={[organizationJsonLd(site, { logo: '/logo.png' }), websiteJsonLd(site)]} />
           {children}
         </body>
       </html>
     )
   }
   ```

   `postMetadata()` sets an absolute title, so a post's title is not suffixed twice by the template.

3. **List your public pages** in `source/lib/seo/routes.ts`. A page that should stay out of search gets `noindex: true` (it stays off the sitemap and `llms.txt`). Posts are added from the database; do not list them here.

4. **Run migration 005** after 004 ([docs/07](07-reproduction-runbook.md#3-run-the-schema-migration)).

5. **Wire the author, if you show one.** `resolveAuthor()` in `source/lib/data.ts` is a stub that returns no author. Point it at your authors and the post's BlogPosting schema gains a `Person` author with the author's own page as its `url`; with no author, the field is left out rather than filled with a placeholder.

## The rules the code follows

- **One canonical per page: its own absolute address**, with no query string or fragment and no trailing slash (except the home page). A preview is `noindex`.
- **Titles sized for a search result.** The brand suffix (" | Acme") is added only when the whole fits in 60 characters; a longer post title is used alone and never cut (the editor's search preview warns past 60). A description falls back to the excerpt and is clipped at 160 characters, the same limit as the preview ([docs/11](11-hardening-and-everyday-comforts.md)).
- **The share card uses the post's featured image and its alt text**, as an absolute address. Use an image at 1200 by 630 pixels; without one, the card falls back to the small `summary` type.
- **Schema says only what the post has.** No author, image, date or category is invented; a missing one is left out. The publisher is the Organization from the root layout, linked by its `@id`.
- **The sitemap lists what the public can read, nothing else.** Pages from `PUBLIC_ROUTES` and live posts only: a draft, a scheduled post before its date, and a post past its end date stay off, by the same rule as the public read policy. Each post carries its last change and its featured image.
- **`robots.txt` keeps crawlers out of `/admin` and `/api/`** and names the sitemap by its absolute address.
- **`llms.txt`** lists the site's pages and live posts with their excerpts, in the plain markdown format AI tools read. A contact line is added only if you pass one.

## A renamed live post keeps its old address

When a live post's address changes (a slug edit published through Staging, or any other write to the posts table, the Data API included), migration 005's trigger:

1. **Adds a permanent redirect from the old address to the new one** (the proxy answers it with a 308, the permanent redirect that keeps the request method; search engines treat it as a 301), category `post-slug-change`, with the signed-in admin whose change made the rename as its last editor.
2. **Points older redirects at the new address.** A redirect that pointed at the old address (with or without a trailing slash) now points straight at the new one, so a visitor makes one hop, never two. One with a query string or a full `https://` address to the old page is left for you to repoint; the Redirects screen lists it as a chain (a full address, when it is on the `NEXT_PUBLIC_SITE_URL` origin). A pattern redirect (`/blog/:slug/amp`) is left alone, since its destination depends on the request.
3. **Switches off any redirect away from the new address**, so a post renamed back to an earlier address is reachable again, with a note on the switched-off row.
4. **Writes an audit row** (`redirect.post_address_changed`) with both addresses and what it changed.

It does nothing for a post that is not live before and after the change (a draft, a scheduled post before its date, a post past its end date), so a draft's working titles never become redirects. It also makes no redirect from an address another live post now uses: when two posts swap addresses in one publish, both stay reachable at their new addresses and the audit rows say no redirect was made.

**Why it waits until the end of the change.** The trigger is a deferred constraint trigger: it runs once the whole publish has finished, and reads the posts as they are then. That is what makes a swap safe (an immediate trigger would see the first half of the swap and send one post's old address to a page that has since moved), and what makes a post renamed twice in one change send every address it passed through to its final one.

**A new post at a freed address wins it back.** When an older post leaves an address, its redirect stays there. A post that later goes live at that address (created, published, or re-dated so it is live) switches the redirect off at the end of the change, with an audit row (`redirect.live_address_reclaimed`), because the proxy redirects before a page renders and the new post could never be reached. A scheduled post that goes live by its date alone changes no row; the scheduler ([docs/12](12-revisions-and-scheduling.md#running-the-scheduler)) marks it published, which does it, and without a scheduler the redirect stays until the post is next saved.

**Under the two-person lock.** The redirect is written by the database itself, so it is saved switched on even when review is required for redirects ([docs/12](12-revisions-and-scheduling.md)). The rename it follows already needed a second admin's approval, so nothing reaches the live site without one.

## Chains and loops

A chain (`/a` to `/b` to `/c`) costs every visitor and crawler an extra round trip and loses link value at each hop. A loop (`/a` to `/b` to `/a`) makes a page unreachable.

- **The Redirects screen lists every chain** with the address to point it at directly, and every loop, under its heading. Only switched-on static redirects are followed; a pattern's destination depends on the request. A full address on the site's own origin (`https://www.example.com/b`, with `NEXT_PUBLIC_SITE_URL` set to that origin) is followed like the path `/b`. A chain longer than 20 hops is listed as a chain to point at its final page, never as a loop.
- **A save or a switch-on that would make a loop is refused**, with the loop spelled out: "This would make a loop: /a -> /b -> /a. Point the redirect at the final page instead." A redirect saved switched off is not refused; it is checked when it is switched on. An edit is checked against the other redirects, never against its own old row.
- **Every redirect is checked.** The switched-on redirects are read a page of 1,000 at a time, so the Data API's row cap never hides one.
- **The check fails closed.** If the other redirects cannot be read, the save is refused and asks you to try again, and the Redirects screen says it could not check rather than showing nothing.

## Before launch

A checklist for the day the site goes live, in the order to do it:

1. `NEXT_PUBLIC_SITE_URL` is the production address and `NEXT_PUBLIC_NOINDEX` is unset in production. Staging and preview deployments have `NEXT_PUBLIC_NOINDEX=1`.
2. `/robots.txt` allows the site and names the sitemap; `/sitemap.xml` lists every public page and every live post, and nothing under `/admin`, no drafts and no ended posts.
3. View the source of one page and one post: one `<h1>`, a title of 60 characters or less, a description, a canonical that is the page's own address, and the Organization and WebSite schema (BlogPosting and BreadcrumbList on the post).
4. Paste a post's address into a schema validator ([Rich Results Test](https://search.google.com/test/rich-results) or [validator.schema.org](https://validator.schema.org/)) and a share-card preview, and fix what they flag.
5. Every post that is live has a featured image at 1200 by 630 with alt text.
6. If the site replaces an older one, every old address that had traffic or links has a one-hop permanent redirect, and the Redirects screen shows no chains and no loops.
7. Submit the sitemap in Google Search Console and Bing Webmaster Tools, then check their indexing reports a week later.
8. Read `/llms.txt`: it should describe the site in its own words.

## Tests

- `source/lib/seo/seo.test.mjs`: the site address rules (production refuses a missing or local address), canonical and absolute addresses, the public visibility rule, titles and descriptions, the metadata and both share cards, the schema and its escaping, the sitemap, robots under both switch settings, and `llms.txt`. 12 tests.
- `source/supabase/tests/address-redirects.test.mjs`: migration 005 on PGlite. A rename through `publish_staged_posts()` with its audit row; chains collapsed with a pattern left alone; renamed back; renamed twice in one change; a trailing-slash destination; a new post winning back a freed address, created as a draft, then published, and created live; drafts, ended and taken-down posts; a draft renamed and published in one change; a swap; the two-person lock; privileges; and the file re-run. 12 tests.
- `source/lib/redirects/chains.test.mjs` and `source/supabase/tests/redirect-actions.test.mjs`: chains, loops, the refusal, the site's own full addresses, chains past the hop limit, and the create, edit and switch-on actions refusing a loop, reading past the 1,000-row cap and failing closed. 14 tests.

Each test was seen failing first: every rule it guards was broken on purpose, one at a time, and the suite turned red each time.

## What it does not do

- **No check of the content itself** (one H1 in the body, skipped heading levels, empty link text). The editor still warns about a long title, a missing description and a missing image ([docs/11](11-hardening-and-everyday-comforts.md)).
- **No check of the share image's size.** Use 1200 by 630; the kit does not measure it.
- **No author pages.** The schema carries an author only once `resolveAuthor()` is wired.
- **The redirect tester and the checks for duplicates and reserved paths** are still the demo's proposals.
- **The loop check runs in the app, not the database.** Two admins saving the two halves of a loop at the same moment can both pass it; the Redirects screen then lists the loop. A database-side check would close that.
- **A slug outside `a-z`, `0-9` and `-`** (possible through the Data API; the editor never makes one) gets a redirect whose source the proxy will not match, because requests arrive percent-encoded.
