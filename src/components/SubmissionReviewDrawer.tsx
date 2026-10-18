import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Drawer } from 'tsp-form';
import { useSubmissionReview, type SubmissionReviewProps, type SubmissionRow } from './SubmissionReviewPanel';

/**
 * The slip review panel in a right-side drawer — for places that open one slip
 * over their own content (the contract chat). The slip page shows the same
 * panel in its detail column instead.
 */
export function SubmissionReviewDrawer({
  row, open, onClose, onSuccess, onChanged,
}: Pick<SubmissionReviewProps, 'onSuccess' | 'onChanged'> & {
  row: SubmissionRow | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  // The host clears `row` in the same handler that closes — keep showing the
  // last slip while the drawer slides out instead of blanking it.
  const lastRow = useRef(row);
  if (row) lastRow.current = row;
  const shown = row ?? lastRow.current;

  // Overlays (confirm boxes, zoom) render beside the Drawer, never inside it:
  // the Drawer unmounts its content once closed, which would cut a box off mid-exit.
  const { panel, overlays } = useSubmissionReview({
    row: shown,
    active: open,
    onSuccess,
    onChanged,
    onNavigate: onClose,
    linkCode: true,
    headerEnd: (
      <button type="button" className="drawer-close-btn" onClick={onClose} aria-label={t('common.close')}>&times;</button>
    ),
  });

  return (
    <>
      <Drawer open={open} onClose={onClose} side="right" ariaLabel={t('paymentSubmissions.review')}>
        {panel}
      </Drawer>
      {overlays}
    </>
  );
}
