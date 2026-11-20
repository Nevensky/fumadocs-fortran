import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { Logo } from '@/components/logo';
import { appName, githubUrl } from './shared';

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
    links: [{ text: 'Documentation', url: '/docs', active: 'nested-url' }],
  };
}
