import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * The top bar of every page in the shell: where you came from, what this page is, and the
 * one or two things you can do to it. It sticks to the top of the content column so the
 * page title and its primary action stay reachable while an operator scrolls a long audit
 * table, and it carries the page's only <h1>.
 *
 * OWNERSHIP STAYS WITH THE PAGE. Each route renders its own header rather than pushing a
 * title up into app/(dashboard)/layout.tsx, because the actions differ per route and a
 * layout that had to be told the title would only move the problem.
 *
 * Presentational and server rendered.
 */

export interface PageHeaderBackLink {
  href: string;
  /** Stands alone: "All apps", not "Back". */
  label: string;
}

export interface PageHeaderProps {
  title: string;
  /** One line under the title saying what this page is for. */
  lede?: ReactNode;
  back?: PageHeaderBackLink;
  /** Links and buttons, right aligned. The primary one goes last. */
  actions?: ReactNode;
  /** Identifiers and timestamps, under the title. */
  meta?: ReactNode;
  /** An audit id or a record hash reads as data, so it is set in the mono face. */
  mono?: boolean;
  titleTestId?: string;
  /** A printed report carries its own header, so the screen one is dropped. */
  noPrint?: boolean;
}

export const PageHeader = ({
  title,
  lede,
  back,
  actions,
  meta,
  mono = false,
  titleTestId,
  noPrint = false,
}: PageHeaderProps) => (
  <div className={`ag-pageheader${noPrint ? ' no-print' : ''}`}>
    <div className="min-w-0">
      {back === undefined ? null : (
        <Link href={back.href} className="ag-back">
          <span aria-hidden="true">&larr;</span>
          {back.label}
        </Link>
      )}
      <h1
        data-testid={titleTestId}
        className={`ag-pageheader-title${mono ? ' ag-pageheader-title-mono' : ''}`}
      >
        {title}
      </h1>
      {lede === undefined ? null : <p className="ag-pageheader-lede">{lede}</p>}
      {meta === undefined ? null : <div className="ag-meta mt-2">{meta}</div>}
    </div>
    {actions === undefined ? null : <div className="ag-pageheader-actions no-print">{actions}</div>}
  </div>
);
