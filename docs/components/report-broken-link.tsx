'use client';
import { useEffect, useState } from 'react';
import { reportUrl } from '@/lib/shared';

const title = 'Docs: broken link';
const problem = 'This address answers "Page not found". The link that led here was on: ';

/**
 * The 404 page's link to report a broken link, as an issue on GitHub. The page is one static file for every missing
 * address (404.html), so the address is filled in in the browser; without JavaScript the issue asks for it.
 */
export function ReportBrokenLink({ className }: { className?: string }) {
  const [href, setHref] = useState(() => reportUrl(title, '(the address in the address bar)', problem));
  useEffect(() => setHref(reportUrl(title, window.location.href, problem)), []);
  return (
    <a href={href} className={className}>
      Report a broken link
    </a>
  );
}
