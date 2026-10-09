"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { nextTheme, themeCookie, type AdminTheme } from "@/lib/admin/theme";

/**
 * The admin's light and dark themes (lib/admin/theme.ts).
 *
 * The admin layout reads the theme cookie on the server and passes it in, so
 * the first paint is already right: no flash and no inline script for the
 * Content Security Policy to allow. The provider mirrors the choice onto
 * <html data-admin-theme> so dialogs and drawers portaled to <body> get the
 * same tokens (globals.css, section 1b).
 */
type ThemeContext = { theme: AdminTheme; toggle: () => void };

const Ctx = createContext<ThemeContext>({ theme: "system", toggle: () => {} });

export default function ThemeProvider({
  children,
  initialTheme = "system",
}: {
  children: React.ReactNode;
  initialTheme?: AdminTheme;
}) {
  const [theme, setTheme] = useState<AdminTheme>(initialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.adminTheme = theme;
    return () => {
      delete root.dataset.adminTheme;
    };
  }, [theme]);

  const toggle = useCallback(() => {
    setTheme((current) => {
      const next = nextTheme(current);
      document.cookie = themeCookie(next, location.protocol === "https:");
      return next;
    });
  }, []);

  return (
    <Ctx.Provider value={{ theme, toggle }}>
      <div data-admin-theme={theme} className="admin-theme-root">
        {children}
      </div>
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeContext {
  return useContext(Ctx);
}
