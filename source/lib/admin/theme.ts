/**
 * The admin's light and dark themes. The choice is a cookie, so the server
 * renders the right theme on the first paint (no flash, no inline script to
 * allow in the CSP). "system" follows the operating system's setting.
 */

export const THEME_COOKIE = 'cms_admin_theme'
export const THEMES = ['system', 'light', 'dark'] as const
export type AdminTheme = (typeof THEMES)[number]

export function parseTheme(raw: string | undefined | null): AdminTheme {
  return (THEMES as readonly string[]).includes(raw ?? '') ? (raw as AdminTheme) : 'system'
}

/** The toggle's cycle: system, then light, then dark, then back. */
export function nextTheme(current: AdminTheme): AdminTheme {
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]
}

export function themeLabel(theme: AdminTheme): string {
  return { system: 'Theme: match system', light: 'Theme: light', dark: 'Theme: dark' }[theme]
}

/** The cookie string to set from the browser (a year, the admin only). */
export function themeCookie(theme: AdminTheme, secure: boolean): string {
  return `${THEME_COOKIE}=${theme}; Path=/admin; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`
}
