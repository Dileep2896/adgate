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
    <h1 className="mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
    <div className="card">
      <p className="text-sm text-stone-700">{summary}</p>
      <p className="mt-3 text-sm font-medium text-stone-500">Coming in {story}.</p>
    </div>
  </section>
);
