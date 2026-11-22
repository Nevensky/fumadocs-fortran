import type { BaseLayoutProps, LinkItemType } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { appName, githubUrl } from './shared';

// the top links of the home layout (the home page and the 404 page): its navbar on wide screens, its menu on phones
const links: LinkItemType[] = [
  { text: 'Get started', url: '/docs/get-started' },
  { text: 'Docs', url: '/docs', active: 'nested-url' },
  { text: 'Showcase', url: '/docs/showcase', active: 'nested-url' },
];

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <span className="inline-flex items-center gap-2 font-semibold">
          <Logo />
          {appName}
        </span>
      ),
    },
    githubUrl,
    links,
  };
}

/**
 * The docs layout's options. Its sidebar lists the three pages of the top links already, so they are given
 * `on: 'nav'`: the docs layout shows its navbar's links nowhere (fumadocs-ui's DocsLayout puts the links that are not
 * for the navbar alone above the sidebar's pages), and the GitHub link stays at the foot of the sidebar.
 */
export function docsOptions(): BaseLayoutProps {
  return { ...baseOptions(), links: links.map((link): LinkItemType => ({ ...link, on: 'nav' })) };
}
