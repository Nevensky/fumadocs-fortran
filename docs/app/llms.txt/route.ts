import { docsLlms } from '@/lib/source';
import { absoluteUrl } from '@/lib/shared';

export const revalidate = false;

// llms.txt (https://llmstxt.org): the title and summary of content/docs/meta.json, then the pages in sidebar order,
// each linked to its Markdown copy, with a section for each sidebar separator (fumadocs writes a separator as a bold
// list item); then the Optional section, which an agent may skip: every page in one file.
export async function GET() {
  const index = (await docsLlms.index()).replace(/^- \*\*(.+)\*\*$/gm, '## $1\n');
  const optional = `## Optional

- [All pages](${absoluteUrl('/llms-full.txt')}): every page of these docs in one Markdown file
`;
  return new Response(`${index.trimEnd()}\n\n${optional}`);
}
