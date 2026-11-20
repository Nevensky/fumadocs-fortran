import type { SVGProps } from 'react';

/** The site's mark: !>, the doc-comment marker of FORD and Doxygen, over a cursor. The ! follows the text colour. */
export function Logo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" {...props}>
      <path d="M8 5.5V18" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="8" cy="24.5" r="2.1" fill="currentColor" />
      <path d="M14 7.5l9 7.5-9 7.5" stroke="#5b4fd6" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 26.5H27" stroke="#0b8aa3" strokeWidth="2.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}
