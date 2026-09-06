import { type DocName, DOC_TITLES, docPath } from '@/lib/doc-links';

/**
 * A pointer to one of the repo's guides. It renders the path the operator can open in their
 * checkout - `docs/integration.md` - with the document's subject as its title, and becomes a
 * real anchor when a deployment publishes those docs somewhere and passes an href.
 *
 * Presentational, and safe in a client component: it reaches nothing but lib/doc-links.ts,
 * which has no imports of its own.
 */

export interface DocRefProps {
  doc: DocName;
  /** Where this deployment publishes the guide, when it publishes it anywhere. */
  href?: string;
}

export const DocRef = ({ doc, href }: DocRefProps) => {
  const path = docPath(doc);
  if (href === undefined) {
    return (
      <code className="ag-code" title={DOC_TITLES[doc]} data-doc={doc}>
        {path}
      </code>
    );
  }
  return (
    <a className="ag-link ag-mono-2xs" href={href} title={DOC_TITLES[doc]} data-doc={doc}>
      {path}
    </a>
  );
};
