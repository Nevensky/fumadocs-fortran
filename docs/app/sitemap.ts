import type { MetadataRoute } from 'next';
import { isGenerated, source } from '@/lib/source';
import { absoluteUrl } from '@/lib/shared';

// written once, at build time, as sitemap.xml beside the pages (with a base path, at <base path>/sitemap.xml). There is
// no robots.txt to name it: a site served under a path of a host, as on GitHub Pages, cannot own the host's.
export const dynamic = 'force-static';
export const revalidate = false;

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: absoluteUrl('/') },
    ...source.getPages().map((page) => ({
      url: absoluteUrl(page.url),
      // the date of the page's last commit, where the build has a Git checkout; a generated page's dates its generator
      lastModified: isGenerated(page) ? undefined : page.data.lastModified,
    })),
  ];
}
