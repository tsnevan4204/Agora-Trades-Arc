import type { Metadata, Viewport } from 'next'
import { Playfair_Display, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { SmoothScrollProvider } from '@/components/smooth-scroll'
import { Web3Provider } from '@/components/providers/web3-provider'
import { GlobalNav } from '@/components/global-nav'
import { Toaster } from 'sonner'
import './globals.css'

const playfair = Playfair_Display({ 
  subsets: ["latin"],
  variable: '--font-serif',
  display: 'swap',
});

const inter = Inter({ 
  subsets: ["latin"],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Agora | Institutional Prediction Markets',
  description: 'The premier prediction market for institutional traders. Real-time crowd-implied probabilities and alternative data for informed decision making.',
  generator: 'v0.app',
  keywords: ['prediction market', 'DeFi', 'institutional trading', 'alternative data', 'Circle Arc'],
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f0f4ef' },
    { media: '(prefers-color-scheme: dark)', color: '#1a1e1a' },
  ],
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${playfair.variable} ${inter.variable}`}>
      <body className="font-sans antialiased overflow-x-hidden" suppressHydrationWarning>
        <Web3Provider>
          <SmoothScrollProvider>
            {children}
          </SmoothScrollProvider>
          <GlobalNav />
        </Web3Provider>
        <Toaster richColors position="top-center" />
        {process.env.NODE_ENV === 'production' && <Analytics />}
      </body>
    </html>
  )
}
