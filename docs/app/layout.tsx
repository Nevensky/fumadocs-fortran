import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import StaticSearchDialog from '@/components/search';
import { appDescription, appName, author } from '@/lib/shared';
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
  title: { template: `%s | ${appName}`, default: appName },
  description: appDescription,
  authors: [{ name: author.displayName, url: author.url }],
  creator: author.name,
  // absolute URLs for the Open Graph images: the site's origin, set when it is built for a host (|| and not ??, as an
  // empty value is not a URL)
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
};

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider search={{ SearchDialog: StaticSearchDialog }}>{children}</RootProvider>
      </body>
    </html>
  );
}
