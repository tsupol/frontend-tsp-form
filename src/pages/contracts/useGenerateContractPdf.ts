// React hook: triggers contract PDF generation. Data assembly lives in
// src/lib/contractPdf/buildRenderData.ts (shared with the preview modal).
// This file only wires React state + the pdfmake download.

import { useCallback, useState } from 'react';
import { downloadContractPdf } from '../../lib/contractPdf/generate';
import {
  buildContractRenderData,
  ContractRenderPrerequisiteError,
  type ContractMin,
  type ContractRenderOverrides,
} from '../../lib/contractPdf/buildRenderData';

// Re-exports kept for back-compat with existing imports.
export type PdfOverrides = ContractRenderOverrides;
export const PdfPrerequisiteError = ContractRenderPrerequisiteError;
export type { ContractMin };

export interface UseGenerateContractPdf {
  generating: boolean;
  generate: (contract: ContractMin, overrides?: PdfOverrides) => Promise<void>;
  error: string | null;
}

export function useGenerateContractPdf(): UseGenerateContractPdf {
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (contract: ContractMin, overrides?: PdfOverrides) => {
    setError(null);
    setGenerating(true);
    try {
      const input = await buildContractRenderData(contract, { overrides });
      const code = contract.code_display ?? contract.code;
      await downloadContractPdf(input, `${code}.pdf`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'pdf generation failed');
      throw err;
    } finally {
      setGenerating(false);
    }
  }, []);

  return { generating, generate, error };
}
