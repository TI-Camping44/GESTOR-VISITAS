import type { Metadata, Viewport } from 'next'
import { IBM_Plex_Sans } from 'next/font/google'
import { RegistrarSW } from '@/components/RegistrarSW'
import './globals.css'

const plex = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-plex', display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Visitas C44', template: '%s · Visitas C44' },
  description: 'Rutas y visitas de los vendedores de Camping 44',
  applicationName: 'Visitas C44',
  appleWebApp: { capable: true, title: 'Visitas C44', statusBarStyle: 'default' },
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
}

export const viewport: Viewport = {
  themeColor: '#1f6f4a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-PY" className={plex.variable}>
      <body className="font-sans antialiased">
        {children}
        <RegistrarSW />
      </body>
    </html>
  )
}
