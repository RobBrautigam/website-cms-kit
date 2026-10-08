# Security

## Reporting a problem

Please report security issues privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (a private advisory). Please do not open a public issue for a security problem.

A useful report says which file and pattern is affected, what an attacker could do, and how to reproduce it. This is a reference kit rather than a running service, so a report is most useful when it shows how a project built from the kit would be exposed.

## Scope

In scope:

- The patterns in `source/`: the proxy, the server gates, the API routes, the SQL migration and its RLS policies, the Storage policies, the MFA and recovery-code flow, the audit log.
- The guidance in `docs/`, where following it as written would leave a project exposed.
- The interactive demo in `demo/`, for anything that lets the page run script it should not, or send data anywhere.

Out of scope:

- Supabase, Next.js, TipTap and other upstream projects: report those to them.
- The demo's sign-in. It is deliberately fake (any password works, the code is `123456`) and protects nothing; all its data is invented and stays in the visitor's own browser.

## The security model in brief

Three layers. Each one refuses on its own what it checks, and the database layer is the one every write passes through. Full detail in [docs/02](docs/02-authentication.md), [docs/03](docs/03-authorization-and-rls.md) and the pre-launch [checklist in docs/08](docs/08-security-checklist.md).

1. **Proxy.** `source/proxy.ts` verifies and refreshes the Supabase session (with `getClaims()`) on every `/admin/*` request and redirects anyone without one. It does not cover `/api/*`.
2. **Server gate.** `requireAdmin()` re-checks the user with Supabase Auth, their role, whether they were deactivated and whether two-factor is complete (AAL2), on every protected page and server-side mutation. The routes that run the two-factor flow itself use `requirePartialAdmin()` (no AAL2 check, or the flow could never finish). User management requires `requireSuperAdmin()`. Writes the editor makes from the browser (posts, image uploads) do not pass through this gate; layer 3 governs them.
3. **Row-level security.** RLS is on for every table. Writes need an active admin through `SECURITY DEFINER` helpers, and a user with a verified factor needs an AAL2 session for any admin read or write, in the tables and in the image bucket (restrictive policies, so a stolen password alone cannot reach the data API); the public key reads published rows only. The MFA recovery-code table has no policy at all (server only), and the audit log is readable by super admins only and written only by the server.

Around those layers:

- **Invite-only accounts.** No public sign-up; invites send a magic link to a set-your-own-password page. No password is ever emailed.
- **Two-factor.** TOTP is mandatory after a grace window. Ten recovery codes, each 12 characters from a 32-letter alphabet, are generated with a cryptographic random source, stored as bcrypt hashes and single-use. Using one removes the user's factors and forces a fresh enrollment.
- **Audit log.** Sign-ins, content changes and every permission change write an append-only row with who, what, when and the client IP as reported by the request's headers. Only the header your host or edge sets is trustworthy (`cf-connecting-ip` behind Cloudflare); behind anything else, a client can send that header itself.
- **Uploads.** Only active admins can write to the image bucket (Storage RLS). The bucket enforces a 5 MB limit server-side and accepts only uploads declared as JPEG, PNG, WebP or GIF; SVG is excluded on purpose. The type is the one the client declares, not a check of the file's bytes. File names are random, and the extension comes from the checked type, never the uploaded name.
- **Secrets.** The service-role (or secret) key is used only in server modules; `server.ts` imports `server-only` so a client import fails the build.

## Known limitations

These are documented choices, not oversights. Each has a recommended fix in the docs.

- **No security headers ship with the kit.** Add them in your `next.config.ts`; a starting set and the CSP plan are in [docs/08](docs/08-security-checklist.md#security-headers).
- **No app-level rate limits.** Supabase Auth limits sign-in, token refresh, TOTP checks and email. The optional paid AI routes and the public redirect hit counter need a limit you add at your edge or proxy.
- **The audit log is append-only by policy, not by trigger.** No role but the server's can write it, but the service-role key could still change rows. If you need tamper evidence, add a trigger that rejects updates and deletes, or ship rows to external storage.
- **Making new recovery codes needs an AAL2 session but not a fresh password.** A stolen, already-verified session could replace the codes. Turning two-factor off does re-check the password; asking for the password (or a TOTP code) before regenerating codes too is the recommended hardening.
- **The redirect hit counter is callable by anyone** (it is how public visits are counted). Treat the counts as approximate.

## Supported versions

This is a reference kit, not a versioned package: fixes land on `main`, and the [CHANGELOG](CHANGELOG.md) records what changed.
