import { cn } from '@/lib/cn';
import { author, citationUrl, copyrightYear, fundingUrl, licenseUrl } from '@/lib/shared';

const link = 'underline-offset-4 transition-colors hover:text-fd-foreground hover:underline';
const dot = <span aria-hidden="true"> · </span>;

/** The copyright line under every page: the author, the licence, and how to cite and support the package. */
export function Credits({ className }: { className?: string }) {
  return (
    <p className={cn('text-sm text-fd-muted-foreground', className)}>
      © {copyrightYear}{' '}
      <a href={author.url} className={link}>
        {author.displayName}
      </a>
      {dot}
      <a href={licenseUrl} className={link}>
        MIT License
      </a>
      {dot}
      <a href={citationUrl} className={link}>
        Cite
      </a>
      {dot}
      <a href={fundingUrl} className={link}>
        Support
      </a>
    </p>
  );
}
