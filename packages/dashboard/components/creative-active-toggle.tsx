import { setCreativeActiveAction } from '@/app/(dashboard)/creatives/actions';

/**
 * Pause or resume one creative. A form posting to a server action, so it works on the list and
 * on the creative's own page without a client component.
 *
 * There is deliberately no Delete: audit records name creative ids and verification recomputes
 * the content hash of the stored row, so a deleted creative would turn every record that served
 * it into an unverifiable one. Deactivating is the whole of "take it down".
 */

export interface CreativeActiveToggleProps {
  id: string;
  active: boolean;
  className?: string;
}

export const CreativeActiveToggle = ({ id, active, className }: CreativeActiveToggleProps) => (
  <form action={setCreativeActiveAction} className={className}>
    <input type="hidden" name="id" value={id} />
    <input type="hidden" name="active" value={active ? 'false' : 'true'} />
    <button
      type="submit"
      data-testid={active ? 'deactivate-creative' : 'reactivate-creative'}
      className="ag-btn ag-btn-xs"
    >
      {active ? 'Deactivate' : 'Reactivate'}
    </button>
  </form>
);
