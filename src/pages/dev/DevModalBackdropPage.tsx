// Repro sandbox: the modal backdrop strands.
//
// SYMPTOM: the dialog closes, but the dim layer stays at full opacity with
// pointer events on, the body stays locked, and every click on the page is
// eaten. Only a reload recovers.
//
// HOW TO USE: press "Start the job" and touch nothing. The dialog opens, runs
// for about a second, then closes itself — the same shape as the signing QR
// dialog, which closes itself once the customer finishes on the capture page.
// The readout below reads the document directly (layer present, dialog count,
// body lock, pointer-events), so the state is visible without dev tools. The
// click counter at the bottom stops responding while the page is dead.
//
// ⚠️ THIS SANDBOX IS ITSELF SUSPECT — it has already produced two false
// conclusions. It strands even with the dialog mounted OUTSIDE anything being
// rebuilt, and the modal mount nodes stay constant throughout, so nothing is
// being unmounted. That points at this dialog simply closing wrong rather than
// at a faithful reproduction of the app bug. The library's own example
// (tsp-form/src/example/main-sections/ExampleModal.tsx) works, and every dialog
// there passes an explicit id while these do not. VERIFY this reproduces the
// real bug before trusting any conclusion drawn from it.
//
// TOGGLES:
//   "INSIDE the card"  — mounts the dialog inside the card that the refresh
//                        rebuilds. That arrangement is forbidden by the guide
//                        (a dialog must not live in something that unmounts).
//                        The real signing screen mounts its dialogs as SIBLINGS
//                        of the cards, so it does NOT have this flaw.
//   "Close first"      — completion closes the dialog before telling the parent
//                        to refresh, instead of refreshing first.
//
// Theories already tested and DISPROVED: switching tabs with a dialog open (a
// real user cannot — the layer blocks the buttons); closing before refreshing;
// closing every dialog when the tab unmounts.

import { useEffect, useState } from 'react';
import { Button, LabeledCheckbox, Modal } from 'tsp-form';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

/** What the document says right now — polled, never inferred. */
function useBackdropState() {
  const [s, setS] = useState({ backdrop: false, locked: false, dialogs: 0, pointer: '', mounts: 0 });
  useEffect(() => {
    const read = () => {
      const bd = document.querySelector('.modal-global-backdrop');
      setS({
        backdrop: !!bd,
        locked: document.body.classList.contains('has-modal-open'),
        dialogs: document.querySelectorAll('[role=dialog]').length,
        pointer: bd ? getComputedStyle(bd).pointerEvents : '',
        mounts: document.querySelectorAll('[data-modal-mount]').length,
      });
    };
    read();
    const id = setInterval(read, 200);
    return () => clearInterval(id);
  }, []);
  return s;
}

/**
 * Stands in for the signing QR dialog: runs a job, and on completion both tells
 * the parent to refresh and closes itself.
 */
function JobDialog({
  open, onClose, onFinished, closeBeforeRefresh,
}: {
  open: boolean;
  onClose: () => void;
  onFinished: () => void;
  closeBeforeRefresh: boolean;
}) {
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');

  useEffect(() => {
    if (!open) { setPhase('idle'); return; }
    setPhase('running');
    const t = setTimeout(() => setPhase('done'), 900);
    return () => clearTimeout(t);
  }, [open]);

  // As shipped: refresh fires the moment the job is done, while the dialog is
  // still mounted and waiting to close.
  useEffect(() => {
    if (closeBeforeRefresh) return;
    if (phase === 'done') onFinished();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // Completion: show the tick briefly, then close. With the toggle on, the
  // refresh is moved here so it lands after the close.
  useEffect(() => {
    if (!open || phase !== 'done') return;
    const t = setTimeout(() => {
      onClose();
      if (closeBeforeRefresh) onFinished();
    }, 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, phase]);

  return (
    <Modal open={open} onClose={onClose} maxWidth="26rem" width="100%" ariaLabel="Job">
      <div className="modal-header">
        <h2 className="modal-title">Job running…</h2>
      </div>
      <div className="modal-content">
        <p className="text-sm">
          {phase === 'done'
            ? 'Done. Closing…'
            : 'Working. This closes itself when it finishes — as the signing QR does.'}
        </p>
      </div>
    </Modal>
  );
}

/** Stands in for a signing card: rebuilt whenever the parent refreshes. */
function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-md border border-line p-4">{children}</div>;
}

export function DevModalBackdropPage() {
  const [fix, setFix] = useState(false);
  const [insideCard, setInsideCard] = useState(true);
  const [open, setOpen] = useState(false);
  // Bumping this rebuilds the card — what a parent refresh does on the real screen.
  const [version, setVersion] = useState(0);
  const s = useBackdropState();

  const stranded = s.backdrop && s.dialogs === 0;

  return (
    <div className="p-6 max-w-3xl flex flex-col gap-5">
      <div>
        <h1 className="heading-2">Stranded backdrop</h1>
        <p className="text-sm text-subtle mt-1">
          Press start and touch nothing. The dialog finishes on its own, tells the
          page to refresh, and closes — the order the signing QR uses.
        </p>
        <div className="alert alert-warning mt-3">
          <AlertTriangle size={16} />
          <div className="alert-description text-xs">
            This sandbox is itself suspect — it strands even with the dialog mounted
            outside anything being rebuilt, and no mount node is ever torn down.
            Confirm it reproduces the real bug before trusting it.
          </div>
        </div>
      </div>

      <div className={`rounded-md border p-3 ${stranded ? 'border-danger-border bg-danger-soft' : 'border-line bg-surface'}`}>
        <div className="flex items-center gap-2">
          {stranded
            ? <AlertTriangle size={16} className="text-danger-fg shrink-0" />
            : <CheckCircle2 size={16} className="text-success-fg shrink-0" />}
          <span className="text-sm font-medium">
            {stranded ? 'STRANDED — dim layer up, no dialog, page is dead' : 'Clean'}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
          <div><span className="text-subtle">Dim layer:</span> {String(s.backdrop)}</div>
          <div><span className="text-subtle">Dialogs:</span> {s.dialogs}</div>
          <div><span className="text-subtle">Page locked:</span> {String(s.locked)}</div>
          <div><span className="text-subtle">Eats clicks:</span> {s.pointer || '—'}</div>
          <div><span className="text-subtle">Mount nodes:</span> {s.mounts}</div>
        </div>
      </div>

      <div className="rounded-md border border-line p-3 flex flex-col gap-2">
        <LabeledCheckbox
          label="Dialog lives INSIDE the card that the refresh rebuilds (the forbidden arrangement — the real screen does NOT do this)"
          checked={insideCard}
          onChange={e => setInsideCard(e.target.checked)}
        />
        <LabeledCheckbox
          label="Close the dialog first, then refresh"
          checked={fix}
          onChange={e => setFix(e.target.checked)}
        />
      </div>

      <div>
        <Button color="primary" onClick={() => setOpen(true)} disabled={open}>
          Start the job
        </Button>
      </div>

      <Card key={version}>
        <div className="text-sm text-subtle">Card (rebuilt on refresh #{version})</div>
        {insideCard && (
          <JobDialog
            open={open}
            onClose={() => setOpen(false)}
            onFinished={() => setVersion(v => v + 1)}
            closeBeforeRefresh={fix}
          />
        )}
      </Card>

      {/* Sibling arrangement — how the real signing screen mounts its dialogs. */}
      {!insideCard && (
        <JobDialog
          open={open}
          onClose={() => setOpen(false)}
          onFinished={() => setVersion(v => v + 1)}
          closeBeforeRefresh={fix}
        />
      )}

      <div className="rounded-md border border-line p-3">
        <div className="text-sm text-subtle mb-2">
          Click target — dead while stranded.
        </div>
        <ClickProbe />
      </div>
    </div>
  );
}

function ClickProbe() {
  const [n, setN] = useState(0);
  return (
    <Button variant="outline" onClick={() => setN(v => v + 1)}>
      Clicked {n} time{n === 1 ? '' : 's'}
    </Button>
  );
}
