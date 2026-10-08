import { cookies } from 'next/headers'
import ThemeProvider from '@/components/ThemeProvider'
import { THEME_COOKIE, parseTheme } from '@/lib/admin/theme'

export default async function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // The admin's theme choice, read on the server so the first paint is right.
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value)
  return (
    <ThemeProvider initialTheme={theme}>
      {children}
    </ThemeProvider>
  )
}
