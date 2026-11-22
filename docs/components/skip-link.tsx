/**
 * A link to the page's content, the first thing on the page and hidden until it has keyboard focus (global.css shows
 * it then), so that a keyboard passes the navbar in one step. For the pages of the home layout: fumadocs-ui's docs
 * layout has its own, to #nd-page, which global.css shows the same way. `target` is the id of the content's element.
 */
export function SkipLink({ target }: { target: string }) {
  return (
    <a href={`#${target}`} className="sr-only" data-skip-link="">
      Skip to content
    </a>
  );
}
