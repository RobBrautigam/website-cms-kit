"use client";

/**
 * No-op ThemeProvider kept as the import surface the admin layout expects.
 *
 * The reference app ships light-mode only, so this is intentionally a
 * pass-through. If you want light/dark theming, swap this for `next-themes`
 * (https://github.com/pacocoursey/next-themes) and add a `[data-theme="dark"]`
 * override block in globals.css that re-points the :root tokens.
 */
export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export function useTheme(): { theme: "light" | "dark"; toggle: () => void } {
  return { theme: "light", toggle: () => {} };
}
