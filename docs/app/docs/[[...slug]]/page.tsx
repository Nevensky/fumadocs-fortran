import { isGenerated, source } from '@/lib/source';
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from 'fumadocs-ui/layouts/docs/page';
import { notFound } from 'next/navigation';
import { getMDXComponents } from '@/components/mdx';
import { PageFooter } from '@/components/page-footer';
import type { Metadata } from 'next';
import { createRelativeLink } from 'fumadocs-ui/mdx';
import {
  absoluteUrl,
  clampText,
  editUrl,
  getPageImageUrl,
  getPageMarkdownUrl,
  gitConfig,
  githubUrl,
  openGraphBase,
  reportUrl,
  siteHref,
} from '@/lib/shared';
import { fortranToc } from 'fumadocs-fortran/react';

export default async function Page(props: PageProps<'/docs/[[...slug]]'>) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;
  const markdownUrl = getPageMarkdownUrl(page).url;
  // the Showcase's reference and sources are generated, so their files on GitHub are not ones to edit (their source
  // links point at the Fortran instead), and their last commit dates the generator's run; the Showcase's index is
  // written by hand
  const generated = isGenerated(page);

  return (
    <DocsPage
      // generated API pages mark each entry with its kind: t type, s subroutine, f function, …
      toc={fortranToc(page.data.toc, page.data.fortran?.toc)}
      full={page.data.full}
      footer={{
        children: (
          <PageFooter
            edit={generated ? undefined : editUrl(page.path)}
            lastModified={generated ? undefined : page.data.lastModified}
            report={reportUrl(`Docs: ${page.data.title}`, absoluteUrl(page.url))}
          />
        ),
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription className="mb-0">{page.data.description}</DocsDescription>
      <div className="flex flex-row gap-2 items-center border-b pb-6">
        <MarkdownCopyButton markdownUrl={markdownUrl} />
        <ViewOptionsPopover
          markdownUrl={markdownUrl}
          githubUrl={
            generated
              ? undefined
              : `${githubUrl}/blob/${gitConfig.branch}/docs/content/docs/${encodeURI(page.path)}`
          }
        />
      </div>
      <DocsBody>
        <MDX
          components={getMDXComponents({
            // this allows you to link to other pages with relative file paths
            a: createRelativeLink(source, page),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps<'/docs/[[...slug]]'>): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  // the page's address as the site links it (the base path, the export's slash); metadataBase gives it its origin
  const url = siteHref(page.url);
  return {
    title: page.data.title,
    // a generated page's description is its doc summary, of up to 300 characters; search engines show about 160
    description: clampText(page.data.description, 160),
    alternates: { canonical: url },
    openGraph: {
      ...openGraphBase,
      type: 'article',
      url,
      title: page.data.title,
      description: clampText(page.data.description),
      images: getPageImageUrl(page).url,
    },
  };
}
