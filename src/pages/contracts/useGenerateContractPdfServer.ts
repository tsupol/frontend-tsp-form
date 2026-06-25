// React hook: triggers contract PDF generation via be-media
// (POST /api/v1/contract/pdf). be-media assembles the document server-side
// from the contract id — no client-side data assembly needed.

import { useCallback, useState } from 'react';
import {
  beMediaContractPdf,
  beMediaContractPreviewAll,
  beMediaContractPrintAll,
  type BeMediaContractDoc,
} from '../../lib/beMedia';
import type { ContractMin } from '../../lib/contractPdf/contractMin';

// What to render:
//  - { signingId }          → one sealed/final signed snapshot
//  - { doc, coLesseeCustomerId? } → one pre-signing SAMPLE preview (live data)
//  - { previewAll: true }   → combined SAMPLE packet of everything to sign
//  - { printAll: true }     → combined PDF of all sealed signings
//  - {} (none)              → live current contract
export interface GeneratePdfTarget {
  signingId?: number;
  doc?: BeMediaContractDoc;
  coLesseeCustomerId?: number;
  previewAll?: boolean;
  printAll?: boolean;
}

export interface UseGenerateContractPdfServer {
  generating: boolean;
  generate: (contract: ContractMin, target?: GeneratePdfTarget) => Promise<void>;
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

  const generate = useCallback(async (contract: ContractMin, target?: GeneratePdfTarget) => {
    setError(null);
    setGenerating(true);
    try {
      let blob: Blob;
      if (target?.previewAll) {
        blob = await beMediaContractPreviewAll(contract.id);
      } else if (target?.printAll) {
        blob = await beMediaContractPrintAll(contract.id);
      } else {
        blob = await beMediaContractPdf({
          contractId: contract.id,
          signingId: target?.signingId,
          doc: target?.doc,
          coLesseeCustomerId: target?.coLesseeCustomerId,
        });
      }
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
