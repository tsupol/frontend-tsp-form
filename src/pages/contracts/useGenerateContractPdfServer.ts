// React hook: triggers contract PDF generation via be-media
// (POST /api/v1/contract/pdf). be-media assembles the document server-side
// from the contract id — no client-side data assembly needed.

import { useCallback, useState } from 'react';
import { beMediaContractPdf } from '../../lib/beMedia';
import type { ContractMin } from '../../lib/contractPdf/buildRenderData';

export interface UseGenerateContractPdfServer {
  generating: boolean;
  // signingId selects a specific signing's document (lease / addendum,
  // sealed vs preview); omit to render the live current contract.
  generate: (contract: ContractMin, signingId?: number) => Promise<void>;
  error: string | null;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function useGenerateContractPdfServer(): UseGenerateContractPdfServer {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (contract: ContractMin, signingId?: number) => {
    setError(null);
    setGenerating(true);
    try {
      const blob = await beMediaContractPdf({ contractId: contract.id, signingId });
      const code = contract.code_display ?? contract.code;
      triggerDownload(blob, `${code}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'server pdf failed');
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generating, generate, error };
}
