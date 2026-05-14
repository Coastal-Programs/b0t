import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/providers/ThemeProvider';
import { SessionProvider } from '@/components/providers/SessionProvider';
import { ClientProvider } from '@/components/providers/ClientProvider';
import { Toaster } from '@/components/ui/sonner';
import { AppLoader } from '@/components/ui/app-loader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ChatFAB } from '@/components/agent-chat/ChatFAB';

const interHeading = Inter({
  weight: ['500', '600', '700'],
  variable: '--font-heading',
  subsets: ['latin'],
});

const interBody = Inter({
  weight: ['400', '500'],
  variable: '--font-body',
  subsets: ['latin'],
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

export const metadata: Metadata = {
  title: 'b0t - Build Custom Automations',
  description:
    'Visual automation platform for building custom workflows. Connect APIs, services, and platforms to create powerful automations.',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <body
        className={`${interHeading.variable} ${interBody.variable} ${inter.variable} antialiased`}
      >
        <AppLoader />
        <ErrorBoundary>
          <ThemeProvider
            attribute="class"
            defaultTheme="dark"
            enableSystem
            disableTransitionOnChange
          >
            <SessionProvider>
              <ClientProvider>{children}</ClientProvider>
            </SessionProvider>
          </ThemeProvider>
        </ErrorBoundary>
        <ChatFAB />
        <Toaster />
      </body>
    </html>
  );
}
