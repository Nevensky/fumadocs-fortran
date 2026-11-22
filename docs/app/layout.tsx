import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import StaticSearchDialog from '@/components/search';
import { appDescription, appName, appTitle, author, siteOpenGraph, siteUrl } from '@/lib/shared';
// The packages' stylesheets come before the site's own, so that global.css can override their variables (such as
// --fdf-mpi): KaTeX's, for the $…$ maths of remark-math and rehype-katex (lib/source.ts), then fumadocs-fortran's,
// for the badges, argument lists and source lines of the generated pages.
import 'katex/dist/katex.css';
import 'fumadocs-fortran/style.css';
import './global.css';

const inter = Inter({
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: { template: `%s | ${appName}`, default: appTitle },
  description: appDescription,
  authors: [{ name: author.displayName, url: author.url }],
  creator: author.name,
  // absolute URLs for the canonical links and the Open Graph tags: the site's origin, set when it is built for a host
  metadataBase: new URL(siteUrl),
  // the site's card when an address is shared: a docs page gives its own (app/docs/[[...slug]]/page.tsx), and the home
  // page adds its address
  openGraph: siteOpenGraph(),
  // a large card on X and others that read these tags, with each page's Open Graph image
  twitter: { card: 'summary_large_image' },
};

// fumadocs-ui's own words, where the site words them otherwise: the docs pages' skip link reads as the home and 404
// pages' (components/skip-link.tsx), in sentence case
const translations = { 'Skip to Content(skip link)': 'Skip to content' };

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-GB" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog: StaticSearchDialog }} i18n={{ translations }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
