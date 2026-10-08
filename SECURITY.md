# Security

## Reporting a problem

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (a private advisory). Please do not open a public issue for a security problem.

A useful report says which file and pattern is affected, what an attacker could do, and how to reproduce it. This is a reference kit rather than a running service, so a report is most useful when it shows how a project built from the kit would be exposed.

## Scope

In scope:

- The patterns in `source/`: the proxy, the server gates, the API routes, the SQL migrations and their RLS policies, the Storage policies, the MFA and recovery-code flow, the audit log, staging and approval (anything that lets the public site or a non-admin read a staged change, or publishes a change in review), and the draft-mode preview switch.
- The guidance in `docs/`, where following it as written would leave a project exposed.
- The interactive demo in `demo/`, for anything that lets the page run script it should not, or send data anywhere.

Out of scope:

- Supabase, Next.js, TipTap and other upstream projects: report those to them.
- The demo's sign-in. It is deliberately fake (any password works, the code is `123456`) and protects nothing; all its data is invented and stays in the visitor's own browser.

## The security model in brief

Three layers. Each one refuses on its own what it checks, and the database layer is the one every write passes through. Full detail in [docs/02](docs/02-authentication.md), [docs/03](docs/03-authorization-and-rls.md) and the pre-launch [checklist in docs/08](docs/08-security-checklist.md).

1. **Proxy.** `source/proxy.ts` verifies and refreshes the Supabase session (with `getClaims()`) on every `/admin/*` request and redirects anyone without one. It does not cover `/api/*`.
2. **Server gate.** `requireAdmin()` re-checks the user with Supabase Auth, their role, whether they were deactivated and whether two-factor is complete (AAL2), on every protected page and server-side mutation. The routes that run the two-factor flow itself use `requirePartialAdmin()` (no AAL2 check, or the flow could never finish). User management requires `requireSuperAdmin()`. Writes the editor makes from the browser (posts, image uploads) do not pass through this gate; layer 3 governs them.
3. **Row-level security.** RLS is on for every table. Writes need an active admin through `SECURITY DEFINER` helpers, and a user with a verified factor needs an AAL2 session for any admin read or write, in the tables and in the image bucket (restrictive policies, so a stolen password alone cannot reach the data API); the public key reads published rows only. The MFA recovery-code table has no policy at all (server only), and the audit log is readable by super admins only, written only by the server, and refuses every edit and delete by trigger (apart from the retention cleanup).

Around those layers:

- **Invite-only accounts.** No public sign-up; invites send a magic link to a set-your-own-password page. No password is ever emailed.
- **Two-factor.** TOTP is mandatory after a grace window. Ten recovery codes, each 12 characters from a 32-letter alphabet, are generated with a cryptographic random source, stored as bcrypt hashes and single-use. Using one removes the user's factors and forces a fresh enrollment.
- **Same-site check.** Every route handler that changes something with the admin's cookie refuses a request that did not come from a page on this site (`Origin`, or `Sec-Fetch-Site` when the origin is opaque), before it checks the session.
- **Headers and limits.** Security headers on every response, a report-only Content Security Policy with a per-request nonce on the admin, a per-admin budget on the AI routes, and a server-only redirect counter limited per visitor and per redirect.
- **Audit log.** Sign-ins, content changes and every permission change write an append-only row with who, what, when and the client IP as reported by the request's headers. Only the header your host or edge sets is trustworthy (`cf-connecting-ip` behind Cloudflare); behind anything else, a client can send that header itself.
- **Uploads.** Only active admins can write to the image buckets (Storage RLS). Images uploaded while editing go to a private bucket and are copied to the public one when their post goes live. The bucket enforces a 5 MB limit server-side and accepts only uploads declared as JPEG, PNG, WebP or GIF; SVG is excluded on purpose. The type is the one the client declares, not a check of the file's bytes. File names are random, and the extension comes from the checked type, never the uploaded name.
- **Secrets.** The service-role (or secret) key is used only in server modules; `server.ts` imports `server-only` so a client import fails the build.
- **Staging.** Staged edits live in a private table with no grant and no policy for the public key, and the public data layer never reads it. The whole-site preview turns on Next.js draft mode only from a same-origin form posted by an admin, and its reads re-check the admin and use the visitor's own session, so a copied preview cookie shows the live site. A change in review needs a different admin to approve it; the database enforces that. Images uploaded for a staged change stay private until it is published.

## Known limitations

These are documented choices, not oversights. Each has a recommended fix in the docs. 1.3.0 closed six earlier ones (no security headers, no app-level rate limits, an audit log append-only by policy only, recovery codes without a password, an open redirect counter, older routes without an origin check); [docs/11](docs/11-hardening-and-everyday-comforts.md) has the details.

- **The Content Security Policy reports; it does not block yet.** It ships report-only on the admin so a new deployment cannot break itself. Collect the reports (`CSP_REPORT_URI`), then set `CSP_MODE=enforce`. Public pages are covered only with `CSP_SCOPE=site`, and statically rendered pages carry no nonce, so read [docs/11](docs/11-hardening-and-everyday-comforts.md#security-headers-and-the-content-security-policy) first. Styles allow `'unsafe-inline'` (Tailwind, TipTap and `next/font` need it).
- **Mandatory review and the two-person lock are off by default.** With `staging_review_required()` and `REVIEW_REQUIRED` switched on, the database refuses any change that puts content on the public site without a second admin's approval. The service role and the table owner are not bound by it, by design (server jobs and migrations).
- **The audit log's trigger binds everyone but the table owner,** who can disable a trigger. For evidence that survives the database owner, ship rows to external storage.
- **Rate limits key on the client address your host reports.** The redirect counter and the audit log read it from request headers; only the header your edge sets is trustworthy (`cf-connecting-ip` behind Cloudflare). The AI limit keys on the admin's user id, which cannot be spoofed.
- **Staged images:** an image uploaded to a post that is never published stays in the private bucket until you clean it up, and images promoted for a publish that then fails stay public.
- **Upload types are the declared type.** The buckets check the Content-Type the client declares, not the file's bytes; SVG is excluded. Sniff the bytes in a server route if real content checking matters.
- **Same-site, not same-origin, for Server Actions.** Route handlers compare the exact origin; Server Actions rely on Next.js's own origin check. If you put the admin behind a proxy that rewrites the host, set the Server Actions `allowedOrigins` option in `next.config.ts` to the exact origins you serve, and nothing wider.

## Supported versions

This is a reference kit, not a versioned package: fixes land on `main`, and the [CHANGELOG](CHANGELOG.md) records what changed.
