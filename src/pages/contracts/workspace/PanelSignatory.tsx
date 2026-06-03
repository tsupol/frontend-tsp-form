import { SignatoryEditor } from './SignatoryEditor';

interface Props { onClose: () => void }

// Kept as a thin wrapper for the wizard's old "signatory" panel slot. The
// actual editor (SignatoryEditor) is now also embedded inline at the top of
// the Documents panel — that's the primary surface for editing signatories.
export function PanelSignatory({ onClose: _onClose }: Props) {
  return (
    <div className="p-4 max-w-2xl">
      <SignatoryEditor />
    </div>
  );
}
