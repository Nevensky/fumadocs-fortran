import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { SiteFooter } from '@/components/credits';
import { docsOptions } from '@/lib/layout.shared';

// The footer comes after the layout, outside its <main>, so that it is the page's footer landmark; fumadocs-ui's
// layout begins with its own skip link, to the page's content.
export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <>
      <DocsLayout tree={source.getPageTree()} {...docsOptions()}>
        {children}
      </DocsLayout>
      <SiteFooter />
    </>
  );
}
