import { useCallback, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, Switch } from 'tsp-form';
import { Printer, RefreshCw, Download } from 'lucide-react';
import { apiClient, ApiError } from '../../lib/api';
import { BillDocRenderer } from '../../components/BillDocRenderer';
import type { BillDoc } from '../../lib/billDoc';
import { printWithMarker } from '../../lib/printDoc';
import {
  adaptBillRender,
  SAMPLE_BILL_PAYLOAD,
  SAMPLE_FREEFORM_DOC,
  type BillRenderPayload,
} from '../../lib/billDocAdapter';

type Source = 'sample' | 'freeform';

export function DevBillPrintPage() {
  const { i18n } = useTranslation();
  const [source, setSource] = useState<Source>('sample');
  const [translateLabels, setTranslateLabels] = useState(false);
  const [showVat, setShowVat] = useState(true);

  // Live-editable JSON of the BE payload (sample source).
  const [payloadText, setPayloadText] = useState(() => JSON.stringify(SAMPLE_BILL_PAYLOAD, null, 2));
  const [payloadErr, setPayloadErr] = useState<string | null>(null);

  // Fetch-by-id (real fn_bill_render).
  const [billId, setBillId] = useState('');
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetching, setFetching] = useState(false);

  const parsedPayload = useMemo<BillRenderPayload | null>(() => {
    try {
      const p = JSON.parse(payloadText) as BillRenderPayload;
      setPayloadErr(null);
      return p;
    } catch (e) {
      setPayloadErr((e as Error).message);
      return null;
    }
  }, [payloadText]);

  const doc: BillDoc | null = useMemo(() => {
    if (source === 'freeform') return SAMPLE_FREEFORM_DOC;
    if (!parsedPayload) return null;
    return adaptBillRender(parsedPayload, { translateLabels, vatRate: showVat ? 7 : null });
  }, [source, parsedPayload, translateLabels, showVat]);

  const handleFetch = useCallback(async () => {
    const id = Number(billId);
    if (!id) { setFetchErr('Enter a numeric bill id'); return; }
    setFetching(true);
    setFetchErr(null);
    try {
      const data = await apiClient.rpc<BillRenderPayload>('fn_bill_render', { p_bill_id: id });
      setPayloadText(JSON.stringify(data, null, 2));
      setSource('sample');
    } catch (e) {
      if (e instanceof ApiError) setFetchErr(`${e.code ?? ''} ${e.message}`.trim());
      else setFetchErr((e as Error).message);
    } finally {
      setFetching(false);
    }
  }, [billId]);

  // ── Print: portal the receipt into body, two RAFs, window.print(). Same
  //    mechanism as BillsPage — reuses the .bill-receipt isolation in app.css. ──
  const [printReady, setPrintReady] = useState(false);
  const handlePrint = useCallback(() => {
    if (!doc) return;
    setPrintReady(true);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      printWithMarker('bill');
      setPrintReady(false);
    }));
  }, [doc]);

  return (
    <div className="page-content max-w-6xl mx-auto p-6 flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Bill Print — block renderer</h1>
        <p className="text-sm text-subtle">
          Unified <code>.bill-receipt</code> CSS + the existing <code>window.print()</code> isolation,
          driven by a modular block document (<code>BillDoc</code>) instead of a fixed struct. Edit the
          BE payload, flip language / VAT, and print. Proves both translatable (<code>{'{key}'}</code>)
          and raw-Thai text in one format.
        </p>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          <Button size="sm" variant={source === 'sample' ? 'solid' : 'outline'} color={source === 'sample' ? 'primary' : undefined} onClick={() => setSource('sample')}>
            BE payload (fn_bill_render)
          </Button>
          <Button size="sm" variant={source === 'freeform' ? 'solid' : 'outline'} color={source === 'freeform' ? 'primary' : undefined} onClick={() => setSource('freeform')}>
            Freeform + nesting demo
          </Button>
        </div>

        <div className="h-5 w-px bg-line" />

        <label className="flex items-center gap-2 text-sm">
          <Switch size="sm" checked={translateLabels} onChange={(e) => setTranslateLabels(e.target.checked)} />
          translate labels (codes → t())
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch size="sm" checked={showVat} onChange={(e) => setShowVat(e.target.checked)} />
          show VAT breakdown
        </label>

        <div className="h-5 w-px bg-line" />

        <div className="flex gap-2">
          <Button size="sm" variant={i18n.language === 'th' ? 'solid' : 'outline'} color={i18n.language === 'th' ? 'primary' : undefined} onClick={() => i18n.changeLanguage('th')}>TH</Button>
          <Button size="sm" variant={i18n.language === 'en' ? 'solid' : 'outline'} color={i18n.language === 'en' ? 'primary' : undefined} onClick={() => i18n.changeLanguage('en')}>EN</Button>
        </div>
      </div>

      {/* Fetch real bill */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="form-label">Fetch real bill via <code>fn_bill_render</code></label>
          <div className="flex gap-2">
            <Input value={billId} onChange={(e) => setBillId(e.target.value.replace(/\D/g, ''))} placeholder="bill id" size="sm" className="w-32" />
            <Button size="sm" variant="outline" startIcon={<RefreshCw size={14} />} onClick={handleFetch} disabled={fetching}>
              {fetching ? 'Fetching…' : 'Fetch'}
            </Button>
            <Button size="sm" variant="outline" startIcon={<Download size={14} />} onClick={() => setPayloadText(JSON.stringify(SAMPLE_BILL_PAYLOAD, null, 2))}>
              Reset to sample
            </Button>
          </div>
        </div>
        {fetchErr && <div className="alert alert-danger text-xs py-1 px-2">{fetchErr}</div>}
      </div>

      {/* Split: JSON editor + live receipt */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <div className="flex flex-col gap-1">
          <label className="form-label">
            {source === 'freeform' ? 'BillDoc (read-only sample)' : 'BE payload JSON (editable)'}
          </label>
          <textarea
            className="better-scroll w-full h-[560px] font-mono text-xs p-3 rounded-md border border-line bg-surface resize-none"
            value={source === 'freeform' ? JSON.stringify(SAMPLE_FREEFORM_DOC, null, 2) : payloadText}
            onChange={(e) => setPayloadText(e.target.value)}
            readOnly={source === 'freeform'}
            spellCheck={false}
          />
          {payloadErr && source === 'sample' && <div className="alert alert-danger text-xs py-1 px-2">JSON: {payloadErr}</div>}
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="form-label">Preview (72mm)</label>
            <Button size="sm" color="primary" startIcon={<Printer size={14} />} onClick={handlePrint} disabled={!doc}>
              Print
            </Button>
          </div>
          <div className="flex justify-center p-6 rounded-md bg-surface-shallow better-scroll overflow-auto" style={{ maxHeight: 600 }}>
            {doc ? <BillDocRenderer doc={doc} hidePrintButton preview /> : <div className="text-sm text-subtle">Fix the JSON to preview.</div>}
          </div>
        </div>
      </div>

      {/* Off-screen print portal — body-mounted so .bill-receipt's @page rule wins. */}
      {printReady && doc && createPortal(
        <div className="print-only-receipt" aria-hidden>
          <BillDocRenderer doc={doc} hidePrintButton />
        </div>,
        document.body,
      )}
    </div>
  );
}
