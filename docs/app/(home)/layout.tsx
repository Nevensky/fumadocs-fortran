import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { SiteFooter } from '@/components/credits';
import { SkipLink } from '@/components/skip-link';
import { baseOptions } from '@/lib/layout.shared';

// HomeLayout's <main> holds its navbar and the page; the skip link comes before both, and the footer after, outside
// the main content. The home page's content has the id the skip link leads to.
export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <>
      <SkipLink target="content" />
      <HomeLayout {...baseOptions()}>{children}</HomeLayout>
      <SiteFooter />
    </>
  );
}
