import ThemeProvider from '@/components/ThemeProvider'

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <ThemeProvider>
      {children}
    </ThemeProvider>
  )
}
