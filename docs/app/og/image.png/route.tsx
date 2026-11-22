import { generateOGImage } from 'fumadocs-ui/og';
import { appName } from '@/lib/shared';

export const revalidate = false;

// the home page's Open Graph image, at /og/image.png (the docs pages' are under /og/docs/). fumadocs-ui's image has
// room for a title of one line and a description of four.
export function GET() {
  return generateOGImage({
    title: 'Fortran API reference',
    description:
      'For Fumadocs sites: FORD, Doxygen and LAPACK doc comments, and HPC code with OpenMP, OpenACC, MPI and LAPACK.',
    site: appName,
  });
}
