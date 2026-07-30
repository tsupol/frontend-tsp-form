import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MobileHeader, InputDateRangePicker, Button, LabeledCheckbox, DataTableFooter,
} from 'tsp-form';
import {
  ArrowRightFromLine, Keyboard, RefreshCw, ExternalLink, CheckCircle2,
  FileSpreadsheet, Clock, AlertTriangle, Inbox, Loader2, ChevronRight, Settings,
} from 'lucide-react';
import { apiClient } from '../../lib/api';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import {
  toLocalDateStr, parseLocalDate, makeDateRangePickerFormat, fmtCurrency,
} from '../../lib/format';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { SetFormUrlModal } from './SetFormUrlModal';

/* ───────────────────────────────────────────────────────────────────────────
 * "กรอกฟอร์ม RICH" — Financier Form Feed.
 * The financier (นายทุน) only accepts daily data via Google Form. Branches used
 * to retype every field by hand. This page pulls the real data (contracts,
 * installments, stock buy-ins, accessory totals), the DB builds a Google Form
 * link with every field pre-filled, and staff just open → eyeball → submit on
 * Google → come back and tick "sent". A helper, not a cop: any row can be
 * unticked (skipped) or exported to CSV for manual copy-paste.
 *
 * Order is DB-driven by category_rank (1=ขาย 2=ซื้อ 3=ผ่อน 4=อุปกรณ์). We never
 * sort categories client-side. Every successful RPC re-fetches the view — state
 * lives in the DB and two people in one branch can work the queue at once.
 * Spec: UI_SUMMARY/130_FINANCIER_FORM_FEED.md · DELIVERY 2026-07-27.
 * ─────────────────────────────────────────────────────────────────────────── */

type Category = 'ขาย' | 'ซื้อ' | 'ผ่อน' | 'อุปกรณ์';
type FeedStatus = 'pending' | 'sent' | 'skipped' | 'voided';

interface FeedRow {
  id: number;
  feed_date: string;
  category: Category;
  status: FeedStatus;
  payload: Record<string, string | null>;
  prefill_url: string | null;
  form_month: string;         // yyyy-mm-01
  form_registered: boolean;
  form_verified: boolean;
  opened_at: string | null;
  sent_at: string | null;
  branch_id: number;
  branch_name: string;
  category_rank: number;
}

/** Column order per §7 — must match the field order in the Google Form so a
 *  copy-paste flows straight down the columns. */
const EXPORT_COLS: Record<Category, string[]> = {
  'ขาย': ['customer_name', 'phone', 'serial', 'imei', 'model', 'down', 'months', 'monthly', 'due_day'],
  'ผ่อน': ['customer_ref', 'installment_no', 'amount'],
  'ซื้อ': ['model', 'price', 'imei', 'serial', 'source', 'battery'],
  'อุปกรณ์': ['case_qty', 'film_qty', 'lens_qty', 'charger_qty', 'cable_qty', 'total_price'],
};

const CATEGORY_ORDER: Category[] = ['ขาย', 'ซื้อ', 'ผ่อน', 'อุปกรณ์'];

function todayIso(): string {
  return toLocalDateStr(new Date());
}

/** yyyy-mm-dd → yyyy-mm-01 */
function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function FinancierFormFeedPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [fromDate, setFromDate] = useState(todayIso());
  const [toDate, setToDate] = useState(todayIso());
  const [isTypingRange, setIsTypingRange] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [rowError, setRowError] = useState('');
  const [busyRowId, setBusyRowId] = useState<number | null>(null);
  // Rows whose Google tab was opened then closed — show an inline "sent?" nudge.
  const [nudgeRowIds, setNudgeRowIds] = useState<Set<number>>(new Set());
  // Manage-forms modal: open flag + optional month to preselect (banner / missing-form).
  const [manageOpen, setManageOpen] = useState(false);
  const [preselectMonth, setPreselectMonth] = useState<string | null>(null);
  const didAutoGen = useRef(false);

  const openManage = useCallback((month?: string) => {
    setPreselectMonth(month ? monthStart(month) : null);
    setManageOpen(true);
  }, []);

  const feedQueryKey = ['financier-feed', fromDate, toDate];

  const { data: rows = [], isFetching, refetch } = useQuery({
    queryKey: feedQueryKey,
    queryFn: () => apiClient.get<FeedRow[]>(
      `/v_financier_feed?feed_date=gte.${fromDate}&feed_date=lte.${toDate}`
      + `&order=category_rank,feed_date,id`,
    ),
    // Wait for the initial auto-generate before the first fetch, so we don't
    // flash "no rows" then pop them in.
    enabled: didAutoGen.current,
  });

  const generate = useCallback(async (from: string, to: string) => {
    setGenError('');
    setGenerating(true);
    try {
      await apiClient.rpc('fn_financier_feed_generate', {
        p_date_from: from,
        p_date_to: to,
      });
    } catch (err) {
      setGenError(translateApiError(err, t));
    } finally {
      setGenerating(false);
      didAutoGen.current = true;
      await queryClient.invalidateQueries({ queryKey: ['financier-feed'] });
    }
  }, [queryClient, t]);

  // Auto-generate today's feed on first mount, then load. Idempotent server-side.
  useEffect(() => {
    if (!didAutoGen.current) generate(fromDate, toDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Group into sections by category, preserving the DB's category_rank order.
  const sections = useMemo(() => {
    const byCat = new Map<Category, FeedRow[]>();
    for (const r of rows) {
      // Never surface voided rows — the DB cuts them; we just hide them.
      if (r.status === 'voided') continue;
      const list = byCat.get(r.category) ?? [];
      list.push(r);
      byCat.set(r.category, list);
    }
    return CATEGORY_ORDER
      .filter(cat => byCat.has(cat))
      .map(cat => {
        const list = byCat.get(cat)!;
        const pending = list.filter(r => r.status === 'pending').length;
        return { category: cat, rows: list, pending };
      });
  }, [rows]);

  // Current section = first with pending rows (expanded); later ones collapse.
  const currentCategory = useMemo(
    () => sections.find(s => s.pending > 0)?.category ?? null,
    [sections],
  );

  // A month is unregistered if any visible row in it lacks a form.
  const unregisteredMonth = useMemo(() => {
    const row = rows.find(r => !r.form_registered && r.status !== 'voided');
    return row ? row.form_month : null;
  }, [rows]);

  const runRowRpc = useCallback(async (id: number, fn: string) => {
    setRowError('');
    setBusyRowId(id);
    try {
      const res = await apiClient.rpc<{ prefill_url?: string }>(fn, { p_id: id });
      await refetch();
      return res;
    } catch (err) {
      setRowError(translateApiError(err, t));
      throw err;
    } finally {
      setBusyRowId(null);
    }
  }, [refetch, t]);

  const handleOpen = useCallback(async (row: FeedRow) => {
    try {
      const res = await runRowRpc(row.id, 'fn_financier_feed_open');
      const url = res?.prefill_url ?? row.prefill_url;
      if (!url) return;
      // New tab only — never iframe. Google login won't run inside a frame.
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) return;
      // When staff closes the tab, nudge them to confirm while it's fresh.
      const timer = window.setInterval(() => {
        if (win.closed) {
          window.clearInterval(timer);
          setNudgeRowIds(prev => new Set(prev).add(row.id));
        }
      }, 800);
    } catch (err) {
      // FORM_URL_MISSING → open the manage modal, preselecting the row's month.
      if (err instanceof ApiError && err.code === 'ETL.FINANCIER.FORM_URL_MISSING') {
        openManage(row.form_month);
      }
    }
  }, [runRowRpc, openManage]);

  const clearNudge = (id: number) => setNudgeRowIds(prev => {
    const next = new Set(prev);
    next.delete(id);
    return next;
  });

  const handleMarkSent = useCallback(async (row: FeedRow) => {
    clearNudge(row.id);
    await runRowRpc(row.id, 'fn_financier_feed_mark_sent').catch(() => {});
  }, [runRowRpc]);

  const handleToggleSend = useCallback(async (row: FeedRow, willSend: boolean) => {
    // untick → skip; tick back → unmark (pending)
    await runRowRpc(row.id, willSend ? 'fn_financier_feed_unmark' : 'fn_financier_feed_skip').catch(() => {});
  }, [runRowRpc]);

  const handleUnmarkSent = useCallback(async (row: FeedRow) => {
    await runRowRpc(row.id, 'fn_financier_feed_unmark').catch(() => {});
  }, [runRowRpc]);

  const monthLabel = useCallback((iso: string) => {
    const d = parseLocalDate(iso);
    if (!d) return iso;
    return d.toLocaleDateString(i18n.language === 'th' ? 'th-TH' : 'en-GB', { month: 'long', year: 'numeric' });
  }, [i18n.language]);

  const dateRangePicker = (
    <InputDateRangePicker
      fromDate={parseLocalDate(fromDate)}
      toDate={parseLocalDate(toDate)}
      onFromDateChange={(d) => setFromDate(toLocalDateStr(d))}
      onToDateChange={(d) => setToDate(toLocalDateStr(d))}
      dateFormat={makeDateRangePickerFormat(i18n.language)}
      size="sm"
      locale={i18n.language}
      calendar="gregorian"
      endIcon={<Keyboard size={14} />}
      onEndIconClick={() => setIsTypingRange(v => !v)}
      typingMode={isTypingRange}
      onTypingModeChange={setIsTypingRange}
      typingMask="##/##/#### - ##/##/####"
      typingPlaceholder="DD/MM/YYYY - DD/MM/YYYY"
      parseTypedDates={(raw) => ({
        from: parseDate8(raw.slice(0, 8)),
        to: raw.length >= 16 ? parseDate8(raw.slice(8, 16)) : null,
      })}
    />
  );

  const fetchBtn = (
    <Button
      variant="primary"
      size="sm"
      startIcon={generating ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
      disabled={generating}
      onClick={() => generate(fromDate, toDate)}
    >
      {t('financierForm.fetch')}
    </Button>
  );

  // Permanent management entry — always available (wrong link / financier swaps
  // mid-month / register next month ahead), not just when a form is missing.
  const manageBtn = (
    <Button
      variant="outline"
      size="sm"
      startIcon={<Settings size={16} />}
      onClick={() => openManage()}
    >
      {t('financierForm.manageButton')}
    </Button>
  );

  const branchTitle = user?.branch_name
    ? t('financierForm.titleBranch', { branch: user.branch_name })
    : t('financierForm.title');

  return (
    <div className="flex flex-col h-dvh">
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('financierForm.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      {/* Desktop header */}
      <div className="flex-none px-4 py-2.5 border-b border-line items-center gap-3 max-md:hidden flex flex-wrap">
        <h1 className="heading-2 whitespace-nowrap">{branchTitle}</h1>
        <div style={{ width: '19rem' }}>{dateRangePicker}</div>
        {fetchBtn}
        <div className="ml-auto">{manageBtn}</div>
      </div>

      {/* Mobile controls */}
      <div className="flex-none p-2 border-b border-line flex items-center gap-2 md:hidden">
        <div className="flex-1 min-w-0">{dateRangePicker}</div>
        {fetchBtn}
        {manageBtn}
      </div>

      <div className={`flex-1 min-h-0 overflow-auto better-scroll ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}>
        <div className="max-w-4xl mx-auto p-4 flex flex-col gap-3">
          {genError && (
            <div className="alert alert-danger"><AlertTriangle size={16} /><span>{genError}</span></div>
          )}
          {rowError && (
            <div className="alert alert-danger"><AlertTriangle size={16} /><span>{rowError}</span></div>
          )}

          {unregisteredMonth && (
            <div className="alert alert-warning items-center">
              <AlertTriangle size={16} />
              <span className="flex-1">
                {t('financierForm.noFormBanner', { month: monthLabel(unregisteredMonth) })}
              </span>
              <Button size="sm" variant="outline" onClick={() => openManage(unregisteredMonth)}>
                {t('financierForm.setUrlButton')}
              </Button>
            </div>
          )}

          {!isFetching && !generating && sections.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 text-subtler py-16">
              <Inbox size={32} strokeWidth={1.5} />
              <span className="text-sm">{t('financierForm.noRows')}</span>
            </div>
          )}

          {sections.map((section) => (
            <FeedSection
              key={section.category}
              category={section.category}
              rows={section.rows}
              pending={section.pending}
              defaultOpen={section.category === currentCategory}
              onExport={() => exportCsv(section.category, section.rows, t, i18n.language)}
              renderRow={(row) => (
                <FeedRowItem
                  key={row.id}
                  row={row}
                  busy={busyRowId === row.id}
                  nudge={nudgeRowIds.has(row.id)}
                  onOpen={() => handleOpen(row)}
                  onMarkSent={() => handleMarkSent(row)}
                  onUnmarkSent={() => handleUnmarkSent(row)}
                  onToggleSend={(willSend) => handleToggleSend(row, willSend)}
                  onDismissNudge={() => clearNudge(row.id)}
                />
              )}
            />
          ))}
        </div>
      </div>

      <SetFormUrlModal
        open={manageOpen}
        preselectMonth={preselectMonth}
        onClose={() => setManageOpen(false)}
        onSaved={() => { refetch(); }}
      />
    </div>
  );
}

/* ── Section (hand-rolled collapsible) ─────────────────────────────────────── */

function FeedSection({
  category, rows, pending, defaultOpen, onExport, renderRow,
}: {
  category: Category;
  rows: FeedRow[];
  pending: number;
  defaultOpen: boolean;
  onExport: () => void;
  renderRow: (row: FeedRow) => ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  // Clamp the page if the row set shrinks (rows leave as they're sent/skipped).
  const safePage = Math.min(pageIndex, totalPages - 1);
  const pageRows = rows.slice(safePage * pageSize, safePage * pageSize + pageSize);

  return (
    <div className="border border-line rounded-md overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-surface">
        <button
          type="button"
          className="flex items-center gap-2 flex-1 min-w-0 bg-transparent border-none cursor-pointer p-0 text-left"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
        >
          <ChevronRight size={16} className={`text-subtle transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="font-medium">{t(`financierForm.category.${categoryKey(category)}`)}</span>
          {pending > 0 ? (
            <span className="text-xs text-subtle">{t('financierForm.remaining', { count: pending })}</span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle2 size={13} /> {t('financierForm.done')}
            </span>
          )}
        </button>
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs text-primary-fg hover:underline bg-transparent border-none cursor-pointer p-0 shrink-0"
          onClick={onExport}
        >
          <FileSpreadsheet size={13} />
          {t('financierForm.exportExcel')}
        </button>
      </div>
      {open && (
        <div className="border-t border-line">
          <div className="px-3 flex flex-col divide-y divide-line">
            {pageRows.map(renderRow)}
          </div>
          {rows.length > pageSize && (
            <div className="padded-datatable px-1">
              <DataTableFooter
                currentPage={safePage}
                totalPages={totalPages}
                onPageChange={setPageIndex}
                pageSize={pageSize}
                pageSizeOptions={[15, 25, 50, 100]}
                onPageSizeChange={(size) => { setPageSize(size); setPageIndex(0); }}
                totalRows={rows.length}
                controlSize="sm"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Row ─────────────────────────────────────────────────────────────────── */

function FeedRowItem({
  row, busy, nudge, onOpen, onMarkSent, onUnmarkSent, onToggleSend, onDismissNudge,
}: {
  row: FeedRow;
  busy: boolean;
  nudge: boolean;
  onOpen: () => void;
  onMarkSent: () => void;
  onUnmarkSent: () => void;
  onToggleSend: (willSend: boolean) => void;
  onDismissNudge: () => void;
}) {
  const { t } = useTranslation();
  const isSent = row.status === 'sent';
  const isSkipped = row.status === 'skipped';
  const isPending = row.status === 'pending';
  const opened = !!row.opened_at;

  return (
    <div className={`flex items-start gap-3 py-2.5 ${isSkipped ? 'opacity-55' : ''}`}>
      {/* tick: checked = will send (pending/sent); unchecked = skipped */}
      <div className="pt-0.5">
        <LabeledCheckbox
          label=""
          checked={!isSkipped}
          disabled={busy || isSent}
          onChange={() => onToggleSend(isSkipped)}
        />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-subtle">
          <DateTime value={row.feed_date} showTime={false} />
          {isSent && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 size={12} />{t('financierForm.statusSent')}</span>}
          {opened && isPending && <span className="inline-flex items-center gap-1 text-warning-fg"><Clock size={12} />{t('financierForm.statusOpened')}</span>}
        </div>
        <div className="text-sm mt-0.5 break-words">{rowPreview(row)}</div>

        {nudge && isPending && (
          <div className="mt-2 flex items-center gap-2 text-xs bg-warning-soft border border-warning-border rounded-md px-2.5 py-1.5">
            <span className="text-warning-fg flex-1">{t('financierForm.sentPrompt')}</span>
            <button type="button" className="text-primary-fg hover:underline bg-transparent border-none cursor-pointer p-0 font-medium" onClick={onMarkSent}>
              {t('financierForm.markSent')}
            </button>
            <button type="button" className="text-subtle hover:text-fg bg-transparent border-none cursor-pointer p-0" onClick={onDismissNudge}>
              {t('financierForm.notYet')}
            </button>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isSent ? (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onUnmarkSent}>
            {t('financierForm.undo')}
          </Button>
        ) : isSkipped ? null : (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !row.prefill_url}
              startIcon={<ExternalLink size={14} />}
              onClick={onOpen}
            >
              {t('financierForm.openForm')}
            </Button>
            <Button
              size="sm"
              variant={opened ? 'primary' : 'outline'}
              disabled={busy}
              onClick={onMarkSent}
            >
              {t('financierForm.markSent')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/* ── Category-specific preview (§4b) ───────────────────────────────────────── */

function rowPreview(row: FeedRow): string {
  const p = row.payload;
  const baht = (v: string | null | undefined) => v ? `${fmtCurrency(Number(v))} ฿` : '—';
  switch (row.category) {
    case 'ขาย':
      return [p.customer_name, p.model, p.down ? `ดาวน์ ${fmtCurrency(Number(p.down))}` : null]
        .filter(Boolean).join(' · ');
    case 'ผ่อน':
      return [p.customer_ref ? `#${p.customer_ref}` : null, p.installment_no ? `งวด ${p.installment_no}` : null, baht(p.amount)]
        .filter(Boolean).join(' · ');
    case 'ซื้อ':
      return [p.model, baht(p.price), p.source].filter(Boolean).join(' · ');
    case 'อุปกรณ์':
      return `รวม ${baht(p.total_price)}`;
    default:
      return '';
  }
}

/* ── CSV export (§7 — UTF-8 BOM, form field order) ─────────────────────────── */

function exportCsv(
  category: Category,
  rows: FeedRow[],
  t: ReturnType<typeof useTranslation>['t'],
  lang: string,
) {
  const cols = EXPORT_COLS[category];
  const header = ['feed_date', 'status', ...cols];
  const headerLabels = header.map(c =>
    t(`financierForm.col.${c}`, { defaultValue: c }),
  );

  const esc = (v: string) => {
    if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
    return v;
  };

  const lines = [headerLabels.map(esc).join(',')];
  for (const row of rows) {
    if (row.status === 'voided') continue;
    const cells = [
      row.feed_date,
      t(`financierForm.status.${row.status}`, { defaultValue: row.status }),
      ...cols.map(c => {
        const v = row.payload[c];
        return v == null ? '' : String(v);
      }),
    ];
    lines.push(cells.map(esc).join(','));
  }

  // UTF-8 BOM so Thai renders correctly in Excel.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-GB').replace(/\//g, '-');
  a.href = url;
  a.download = `financier_${categoryKey(category)}_${stamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function categoryKey(cat: Category): string {
  return { 'ขาย': 'sale', 'ซื้อ': 'buyin', 'ผ่อน': 'installment', 'อุปกรณ์': 'accessory' }[cat];
}

function parseDate8(digits: string): Date | null {
  if (digits.length !== 8) return null;
  const day = parseInt(digits.slice(0, 2), 10);
  const month = parseInt(digits.slice(2, 4), 10);
  let year = parseInt(digits.slice(4, 8), 10);
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}
