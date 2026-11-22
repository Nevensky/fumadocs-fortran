import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { generateOGImage } from 'fumadocs-ui/og';
import { appName, clampText, getPageImageUrl } from '@/lib/shared';

export const revalidate = false;

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  // fumadocs-ui's image sets the title in about 23 characters a line and the description in about 40, with room for
  // five lines in all: four of description under a title of one line, three under one of two. A generated page's
  // description is its doc comment's summary, of any length.
  const title = page.data.title;
  return generateOGImage({
    title,
    description: clampText(page.data.description, title.length > 23 ? 105 : 140),
    site: appName,
  });
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImageUrl(page).segments,
  }));
}
