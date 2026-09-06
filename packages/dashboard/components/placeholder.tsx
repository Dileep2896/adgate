import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';

/**
 * A section that exists in the nav but is filled in by a later story. S30 is the scaffold:
 * only /apps reads the database. Every placeholder names the story that replaces it.
 */

export interface PlaceholderProps {
  title: string;
  story: string;
  summary: string;
}

export const Placeholder = ({ title, story, summary }: PlaceholderProps) => (
  <section>
    <PageHeader title={title} />
    <EmptyState title={`Coming in ${story}.`} testId="placeholder">
      {summary}
    </EmptyState>
  </section>
);
