import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// the search index is built once, at build time, and searched in the browser, so the site also works as static files
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
