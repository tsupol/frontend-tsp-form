// React hook: triggers contract PDF generation via the nnf-misc-go server
// endpoint (POST /api/v1/contract/pdf). Reuses the shared buildContractRenderData
// data assembly so the server gets the same input shape the preview uses.

import { useCallback, useState } from 'react';
import { config } from '../../config/config';
import {
  buildContractRenderData,
  type ContractMin,
} from '../../lib/contractPdf/buildRenderData';

export interface UseGenerateContractPdfServer {
  generating: boolean;
  generate: (contract: ContractMin) => Promise<void>;
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

  const generate = useCallback(async (contract: ContractMin) => {
    setError(null);
    setGenerating(true);
    try {
      const input = await buildContractRenderData(contract);
      const res = await fetch(`${config.uploadUrl}/contract/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = j?.error?.message || j?.error?.code || '';
        } catch {
          /* non-json body */
        }
        throw new Error(`server pdf ${res.status}${detail ? `: ${detail}` : ''}`);
      }
      const blob = await res.blob();
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
