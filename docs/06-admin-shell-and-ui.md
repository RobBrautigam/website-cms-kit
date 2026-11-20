# 06 - Admin Shell and UI

The chrome around every protected page, the shared primitives, the design-token system, and image upload.

## The shell (`source/components/admin/AdminShell.tsx`)

`AdminShell` is the frame the `(admin)` layout wraps around every page. It renders:
- a persistent left **sidebar** on desktop (`AdminSidebar`),
- a **hamburger + slide-in drawer** on mobile (`AdminDrawer`, the same sidebar in a portal),
- the page content in a centered max-width container (or full-bleed when `fullWidth`),
- a `sonner` `<Toaster>` for toasts (top-right desktop, top-center mobile).

It takes `userEmail` and `userRole` (passed down from the layout's `requireAdmin()` result) so the sidebar can show identity and role-gate nav items without re-querying.

## Navigation (`source/components/admin/AdminSidebar.tsx`)

Nav is a declarative `navSections` array grouped into Content / Site / Organization / Audit. Each item can be `adminOnly` (admin + super) or `superAdminOnly` (Team, Audit Log). The sidebar filters items by `userRole`, highlights the active route via `usePathname`, and has a footer with the signed-in email, a role chip, Change Password, Sign Out, and the app version. Add a resource to the nav by adding one entry here.

`AdminDrawer` wraps the same `AdminSidebar` in a `createPortal` overlay with a focus trap, body-scroll lock, reduced-motion-aware transitions, and `inert` when closed. The a11y hooks it uses (`useFocusTrap`, `useBodyScrollLock`, `usePrefersReducedMotion`) live in `source/lib/a11y/` and are reusable for any overlay.

## Shared primitives (`source/components/admin/`)

| Component | What it does |
|---|---|
| `ModalShell` | Accessible dialog: focus trap, escape + backdrop dismiss, focus return, `aria-modal`. Base for all modals. |
| `ConfirmDialog` | High-stakes confirm built on `ModalShell`. Gerund pending label ("Deleting..."), danger/primary tone. |
| `RowDeleteButton` | Trigger -> `ConfirmDialog` -> bound delete action -> toast. Id is bound server-side. |
| `SubmitButton` | Disables itself while the parent form's action is pending (`useFormStatus`). |
| `ToggleButton` | Optimistic on/off (`useOptimistic`) calling a bound server action; auto-reverts on failure. |
| `ChangePassword` | Modal that updates the password with the live strength checklist. |

These are deliberately small and composable. They encode the fiddly correctness (focus management, optimistic-revert, server-side id binding) once so resource code stays declarative.

## The design-token system (`source/app/globals.css`)

Components mostly use **semantic token classes**: `bg-bg-card`, `bg-bg-white`, `text-text-primary`, `text-text-secondary`, `text-accent`, `border-border`, plus component classes `btn-primary`, `btn-outline`, `card`, `heading-display`. All of them resolve to CSS custom properties defined in one `:root` block in `globals.css`, mapped to Tailwind v4 utilities via `@theme inline`. Some surfaces and status colors still use raw Tailwind palette classes (`bg-white`, `text-white`, `text-red-600`, `text-amber-700`, `text-green-700` and others), and `globals.css` maps several of them for the dark theme by hand.

To re-theme the admin surface, edit the values in the `:root` block (the kit ships a neutral slate + blue palette), the `[data-admin-theme="dark"]` block, the system-theme block after it and the dark-theme overrides for raw classes further down, and change those raw palette classes where your palette differs (a new raw class needs its own dark-theme override). The token layer follows the design-token discipline Linear/Stripe/Vercel use: components carry zero hardcoded hex values, and the kit depends on no external design-token package.

Fonts are `--font-display` / `--font-body` (a system stack by default - point them at your own webfonts). The `.tiptap` rules style the rich-text editor and rendered article prose.

## Image upload (`source/components/admin/ImageUploader.tsx`)

Uploads go straight from the browser client to the private Supabase Storage `blog-images-staged` bucket, then return to the form the public URL the image will have once the kit copies it to the public `blog-images` bucket: when its post is published or scheduled (with `SCHEDULED_IMAGES=at_publish`, by the post's date), or when the testimonial using it is saved ([docs/11](11-hardening-and-everyday-comforts.md#staged-images-stay-private-until-publish), [docs/13](13-media-library.md#testimonial-images-a-fix)). Both the featured-image picker and the editor's inline image button use one helper, `lib/admin/upload-image.ts`: it checks type and size, names the file `<random-uuid>.<ext>` under a `blog/` prefix with the extension taken from the checked MIME type (never the file name), and sets a 1-year cache header. The `/api/upload` route is an alternative server-side upload path that imports the same type list and size cap (nothing in the kit calls it; use it if you want a server to check uploads before they reach Storage). Migration 000 creates the public bucket and migration 002 the private one, each with Storage policies that let only an active admin write to it (see [08-security-checklist.md](08-security-checklist.md)).

## Icons + theming notes

Functional icons use `lucide-react`. Since 1.3.0 the admin has a real dark theme: `ThemeProvider` (`source/components/ThemeProvider.tsx`) holds light, dark or system, the sidebar toggle cycles them, and the choice is kept in a cookie (`lib/admin/theme.ts`) so the server renders the right theme with no flash; `globals.css` overrides the tokens under `[data-admin-theme="dark"]`. The interactive demo works the same way: `demo/app/app.css` has the light tokens, one `[data-theme="dark"]` block that overrides them, and a toggle that follows the system setting until the user picks. The whole UI is responsive and verified at mobile + desktop widths; keep that in mind when extending it.
