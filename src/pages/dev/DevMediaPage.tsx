import { useState } from 'react';
import { MediaLightbox, MediaThumbButton } from '../../components/MediaLightbox';

const HARDCODED_PRIVATE_KEY = 'private/contracts/81/signature-166882-sm.webp';

export function DevMediaPage() {
  const [open, setOpen] = useState(false);

  return (
    <div className="p-6 flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="text-lg font-semibold">Media Viewer Sandbox</h1>
        <p className="text-sm text-subtle mt-1">
          Hardcoded private key: <code className="text-xs">{HARDCODED_PRIVATE_KEY}</code>
        </p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-subtle">Single image</h2>
        <MediaThumbButton
          mediaKey={HARDCODED_PRIVATE_KEY}
          alt="signature sample"
          onClick={() => setOpen(true)}
        />
        <code className="text-xs text-subtler break-all">{HARDCODED_PRIVATE_KEY}</code>
        <p className="text-xs text-subtler">Click the thumbnail to open the lightbox.</p>
      </section>

      <MediaLightbox
        open={open}
        onClose={() => setOpen(false)}
        mediaKey={HARDCODED_PRIVATE_KEY}
        alt="signature sample"
      />
    </div>
  );
}
