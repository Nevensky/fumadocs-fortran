// the date as the site writes dates (en-GB), the same wherever and whenever the site is built
const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long', timeZone: 'UTC' });

const link = 'underline underline-offset-4 transition-colors hover:text-fd-foreground';
const row = 'flex flex-row flex-wrap items-center gap-x-6 gap-y-2 border-t pt-4 text-sm text-fd-muted-foreground';

/**
 * The foot of a docs page, under Previous and Next: a link to edit the page on GitHub and the date it last changed (on
 * hand-written pages: a generated page changes through its generator), and a link to report a problem with it.
 */
export function PageFooter({ edit, lastModified, report }: { edit?: string; lastModified?: Date; report: string }) {
  return (
    <div className={row}>
      {edit && (
        <a href={edit} className={link}>
          Edit this page on GitHub
        </a>
      )}
      <a href={report} className={link}>
        Report a problem with this page
      </a>
      {lastModified && (
        <p className="sm:ms-auto">
          Last updated on <time dateTime={lastModified.toISOString()}>{dateFormat.format(lastModified)}</time>
        </p>
      )}
    </div>
  );
}
