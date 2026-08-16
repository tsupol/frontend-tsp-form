// The serial, rendered for reading at arm's length while the device is in the
// other hand. Two presentations of the same thing:
//
//   <SerialHero>       — the public token page. Big by default, no click needed.
//                        The link holder has NOTHING else on screen to identify
//                        the device by; making them find a magnifier first is a
//                        step between them and the one check that matters.
//   <SerialZoomModal>  — tab-1. Staff already have the asset record around them,
//                        so it stays compact until they ask for it.
//
// Both letter-space the characters (Ohm: "A B C D E") and keep the whole serial
// on ONE line — a wrapped serial defeats the comparison entirely.

import { useTranslation } from 'react-i18next';
import { Modal, Button } from 'tsp-form';

/**
 * Size the text off the serial's LENGTH, not a fixed clamp: mono glyphs are
 * ~0.6em wide and each one also carries the letter-spacing, so N characters
 * occupy roughly N × 0.82em. A fixed size either wraps the long ones or wastes
 * the short ones.
 */
function fitFontSize(len: number, maxVw: number, cap: string): string {
  return `min(${maxVw}vw, ${(90 / Math.max(len * 0.82, 1)).toFixed(2)}vw, ${cap})`;
}

/** Big, spaced, unmissable. The hero of the public page. */
export function SerialHero({ serial }: { serial: string | null }) {
  const { t } = useTranslation();
  if (!serial) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 w-full min-w-0">
      <div className="text-xs text-subtle">{t('remoteEnroll.serialLabel')}</div>
      <div
        className="font-mono font-bold text-center leading-tight whitespace-nowrap w-full select-all"
        style={{
          fontSize: fitFontSize(serial.length, 11, '2.75rem'),
          letterSpacing: '0.18em',
          textIndent: '0.18em', // trailing letter-space would push it off-centre
        }}
      >
        {serial}
      </div>
      <p className="text-xs text-subtle text-center">{t('remoteEnroll.serialHint')}</p>
    </div>
  );
}

/** tab-1's full-screen zoom. Always mounted — the Modal rule. */
export function SerialZoomModal({
  open, serial, onClose,
}: {
  open: boolean;
  serial: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} maxWidth="min(64rem, 96vw)" width="100%">
      <div className="modal-header">
        <h2 className="modal-title">{t('asset.mdm.serialCheck.title')}</h2>
        <button type="button" className="modal-close-btn" onClick={onClose}>&times;</button>
      </div>
      <div className="modal-content min-w-0">
        <div className="flex flex-col items-center gap-4 py-4 min-w-0 w-full">
          <div
            className="font-mono font-bold text-center leading-tight whitespace-nowrap w-full select-all"
            style={{
              fontSize: fitFontSize(serial?.length ?? 1, 9, '4rem'),
              letterSpacing: '0.22em',
              textIndent: '0.22em',
            }}
          >
            {serial}
          </div>
          {/* An unspaced copy underneath, for reading it back normally. */}
          <div className="font-mono text-base text-subtle break-all text-center select-all">
            {serial}
          </div>
          <p className="text-xs text-subtle text-center">{t('asset.mdm.serialCheck.hint')}</p>
        </div>
      </div>
      <div className="modal-footer">
        <Button variant="ghost" onClick={onClose}>{t('common.close')}</Button>
      </div>
    </Modal>
  );
}
