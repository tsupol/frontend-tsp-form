import { useRef, useState } from 'react';
import { Button } from 'tsp-form';
import { Eraser, Undo2, Save } from 'lucide-react';
import { SignaturePad, type SignaturePadHandle } from '../../components/SignaturePad';

export function DevSignaturePage() {
  const padRef = useRef<SignaturePadHandle>(null);
  const [isEmpty, setIsEmpty] = useState(true);
  const [savedDataUrl, setSavedDataUrl] = useState<string | null>(null);
  const [savedSize, setSavedSize] = useState<number | null>(null);

  const handleSave = async () => {
    const blob = await padRef.current?.toBlob('image/png');
    if (!blob) return;
    const url = padRef.current?.toDataURL('image/png') ?? null;
    setSavedDataUrl(url);
    setSavedSize(blob.size);
  };

  const handleClear = () => {
    padRef.current?.clear();
    setSavedDataUrl(null);
    setSavedSize(null);
  };

  return (
    <div className="page-content max-w-3xl mx-auto p-6 flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Signature Pad</h1>
        <p className="text-sm text-subtle">
          Draft sandbox for on-screen signing. Works with touch (iPad), mouse, and stylus.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="border border-line rounded-lg overflow-hidden bg-white aspect-[2/1] w-full">
          <SignaturePad ref={padRef} onChange={setIsEmpty} />
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <Button onClick={() => padRef.current?.undo()} disabled={isEmpty} startIcon={<Undo2 size={16} />}>
            Undo
          </Button>
          <Button onClick={handleClear} disabled={isEmpty} startIcon={<Eraser size={16} />}>
            Clear
          </Button>
          <Button color="primary" onClick={handleSave} disabled={isEmpty} startIcon={<Save size={16} />}>
            Save preview
          </Button>
        </div>
      </div>

      {savedDataUrl && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Saved PNG preview</h2>
            <span className="text-xs text-subtle">
              {savedSize != null ? `${(savedSize / 1024).toFixed(1)} KB` : ''}
            </span>
          </div>
          <div className="border border-line rounded-lg overflow-hidden bg-white aspect-[2/1] w-full flex items-center justify-center">
            <img src={savedDataUrl} alt="Saved signature" className="max-w-full max-h-full" />
          </div>
        </div>
      )}
    </div>
  );
}
