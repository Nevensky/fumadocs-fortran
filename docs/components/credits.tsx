import { cn } from '@/lib/cn';
import {
  author,
  citationUrl,
  copyrightYear,
  fundingUrl,
  issuesUrl,
  licenseUrl,
  noticesUrl,
  statusSentence,
} from '@/lib/shared';

// links stay underlined, so that they read as links without their colour
const link = 'underline underline-offset-4 transition-colors hover:text-fd-foreground';
const dot = <span aria-hidden="true"> · </span>;

// what GitHub Pages does with its visitors' addresses, in its own words
const pagesDataUrl =
  'https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages#data-collection';

/**
 * The credits line: the author, the licence, the notices of the third-party material the package ships (the
 * registry's cards show it on the generated pages), how to cite and support the package, and its issues.
 */
export function Credits({ className }: { className?: string }) {
  return (
    <p className={className}>
      © {copyrightYear}{' '}
      <a href={author.url} className={link}>
        {author.displayName}
      </a>
      {dot}
      <a href={licenseUrl} className={link}>
        MIT licence
      </a>
      {dot}
      <a href={noticesUrl} className={link}>
        Notices
      </a>
      {dot}
      <a href={citationUrl} className={link}>
        Cite
      </a>
      {dot}
      <a href={fundingUrl} className={link}>
        Sponsor
      </a>
      {dot}
      <a href={issuesUrl} className={link}>
        Issues
      </a>
    </p>
  );
}

/**
 * The site's footer, under every page and outside its main content, so that it is the page's one footer landmark:
 * the credits, the package's status and what the site does with its visitors' data.
 */
export function SiteFooter({ className }: { className?: string }) {
  return (
    <footer className={cn('border-t px-4 py-8 text-sm text-fd-muted-foreground', className)}>
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-2 text-center">
        <Credits />
        <p>{statusSentence}</p>
        <p>
          This site sets no cookies, runs no analytics and loads nothing from other sites; search runs in your browser.
          GitHub, which hosts it,{' '}
          <a href={pagesDataUrl} className={link}>
            logs visitors&apos; IP addresses
          </a>{' '}
          for security.
        </p>
      </div>
    </footer>
  );
}
