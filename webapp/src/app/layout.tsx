import './globals.css';
import { Toaster } from 'sonner';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'TaskTitan - Component-Based Project Planning',
  description:
    'Plan your code structure before you write a line. Break down projects into components, assign ownership, visualize dependencies.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Outfit:wght@300;400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
        {/* Comment out this meta tag if you want to enable search engine crawling */}
        <meta name="robots" content="noindex, nofollow" />
      </head>
      <body className="bg-slate-950 text-slate-100 antialiased">
        {children}
        <Toaster
          position="top-right"
          theme="dark"
          toastOptions={{
            style: {
              background: '#1e293b',
              border: '1px solid #334155',
              color: '#f1f5f9',
            },
          }}
        />
      </body>
    </html>
  );
}
