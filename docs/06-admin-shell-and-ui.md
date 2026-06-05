# 06 — Admin Shell and UI

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

Components never use raw colors. They use **semantic token classes**: `bg-bg-card`, `bg-bg-white`, `text-text-primary`, `text-text-secondary`, `text-accent`, `border-border`, plus component classes `btn-primary`, `btn-outline`, `card`, `heading-display`. All of them resolve to CSS custom properties defined in one `:root` block in `globals.css`, mapped to Tailwind v4 utilities via `@theme inline`.

To re-theme the entire admin surface, edit the values in that one `:root` block (the kit ships a neutral slate + blue palette). Nothing else needs to change. This is the design-token discipline Linear/Stripe/Vercel use, and it is why the kit has zero hardcoded hex values in components and no dependency on any external design-token package.

Fonts are `--font-display` / `--font-body` (a system stack by default — point them at your own webfonts). The `.tiptap` rules style the rich-text editor and rendered article prose.

## Image upload (`source/components/admin/ImageUploader.tsx`)

Uploads go straight to the Supabase Storage `blog-images` bucket from the browser client, then return the public URL to the form. Files are content-addressed (`<timestamp>-<rand>.<ext>`) under a `blog/` prefix with a 1-year cache header. The `/api/upload` route is an alternative server-side upload path. Create the bucket per [09-environment-and-deploy.md](09-environment-and-deploy.md) (public, 5 MB limit, image MIME allow-list).

## Icons + theming notes

Functional icons use `lucide-react`. The `ThemeProvider` (`source/components/ThemeProvider.tsx`) is a no-op pass-through (the reference app is light-mode only); swap it for `next-themes` and add a `[data-theme="dark"]` token override in `globals.css` if you want dark mode. The whole UI is responsive and verified at mobile + desktop widths; keep that in mind when extending it.
