import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// the search index is built once, at build time, and searched in the browser, so the site also works as static files.
// The route's name gives the exported file its extension, api/search.json, so that a server that compresses by type
// (nginx, serve) sends it as application/json, compressed; without one, it goes uncompressed. GitHub Pages compresses
// both.
export const revalidate = false;
export const { staticGET: GET } = createFromSource(source);
