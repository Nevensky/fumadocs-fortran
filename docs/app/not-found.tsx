import type { Metadata } from 'next';
import Link from 'next/link';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { FullSearchTrigger } from 'fumadocs-ui/layouts/shared/slots/search-trigger';
import { SiteFooter } from '@/components/credits';
import { ReportBrokenLink } from '@/components/report-broken-link';
import { SkipLink } from '@/components/skip-link';
import { baseOptions } from '@/lib/layout.shared';

// every address the site lacks: the static export writes it as 404.html, which GitHub Pages serves for them. Next
// adds its noindex tag.
export const metadata: Metadata = { title: 'Page not found' };

const link = 'font-medium underline underline-offset-4 hover:text-fd-primary';

// Next sends this page with every page of the site, and loads the client components it uses on each: HomeLayout,
// which the home page loads too, the search button of the docs sidebar and the report link
export default function NotFound() {
  return (
    <>
      <SkipLink target="content" />
      <HomeLayout {...baseOptions()}>
        <div id="content" className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 px-4 py-16">
          <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
          <p className="text-fd-muted-foreground">
            No page of this site has this address. Search for what you were looking for, or start from one of these
            pages.
          </p>
          <FullSearchTrigger className="w-full" />
          <ul className="flex flex-col gap-2">
            <li>
              <Link href="/docs/get-started" className={link}>
                Get started
              </Link>
              : from your Fortran sources to their reference in a Fumadocs site
            </li>
            <li>
              <Link href="/docs" className={link}>
                Introduction
              </Link>
              : what fumadocs-fortran does, and the page for each job
            </li>
            <li>
              <Link href="/docs/showcase" className={link}>
                Showcase
              </Link>
              : the reference generated for the project&apos;s own example
            </li>
          </ul>
          <p className="text-sm text-fd-muted-foreground">
            <ReportBrokenLink className={link} /> if a link on this site led here: it opens an issue on GitHub with
            this address filled in.
          </p>
        </div>
      </HomeLayout>
      <SiteFooter />
    </>
  );
}
