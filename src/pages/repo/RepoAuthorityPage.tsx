// ใบมอบอำนาจ — the authority letters the repo/legal team carries.
//
// One live letter per (company × agent × kind); revoking one does not block a
// reissue. Admins (OPS.REPO.GRANT) issue and revoke for anyone in the company;
// an agent sees their own rows and can print a blank copy to have the company
// sign ahead of time. The field sheet with the customer's device-return section
// is printed from the job itself, not here.
//
// A letter that is live but whose company verification toggle is off will fail
// a scan at the door, so that row says so rather than looking healthy.
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, DataTable, Tooltip, MobileHeader, Modal, Select, TextArea, useSnackbarContext } from 'tsp-form';
import {
  ArrowRightFromLine, ShieldCheck, AlertTriangle, CheckCircle, XCircle, Loader2,
  Plus, Printer, Ban, User,
} from 'lucide-react';
import { ApiError } from '../../lib/api';
import { translateApiError } from '../../lib/apiErrors';
import { useAuth } from '../../contexts/AuthContext';
import { DateTime } from '../../components/DateTime';
import { ModalErrorBand } from '../../components/ModalErrorBand';
import { ActionDoneView } from '../contracts/ActionDoneView';
import { PdfCanvasViewer } from '../../components/PdfCanvasViewer';
import { beMediaRepoAuthorityPdfById, openPdfInNewTab, BeMediaError } from '../../lib/beMedia';
import {
  fetchRepoAuthorities, fetchRepoGrants, repoAuthorityIssue, repoAuthorityVoid,
  type RepoAuthorityRow, type RepoAuthorityKind,
} from './repoApi';

const ADMIN_ROLES = ['COMPANY_ADMIN', 'HOLDING_ADMIN', 'SYSTEM_DEV'];
const KINDS: RepoAuthorityKind[] = ['REPO', 'LEGAL'];

function apiErr(err: unknown, t: ReturnType<typeof useTranslation>['t']): string {
  if (err instanceof ApiError) return translateApiError(err, t) || err.message;
  if (err instanceof BeMediaError) return t(err.code, { ns: 'apiErrors', defaultValue: err.message });
  return t('common.error');
}

// ── Issue ───────────────────────────────────────────────────────────────────
// Issuing returns a token, not a row, so the done view reports what happened
// and the list is re-read behind it.
function IssueAuthorityModal({ open, onClose, companyId, onIssued }: {
  open: boolean;
  onClose: () => void;
  companyId: number | null;
  onIssued: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [agentId, setAgentId] = useState<string | null>(null);
  const [kind, setKind] = useState<RepoAuthorityKind>('REPO');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ agent: string; kind: string; reused: boolean } | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);

  // Only users who actually hold the matching grant can carry a letter, so the
  // picker is the grant list, not every user in the company.
  const { data: grants = [] } = useQuery({
    queryKey: ['repo', 'grants', companyId],
    queryFn: () => fetchRepoGrants(companyId!),
    enabled: open && companyId != null,
    staleTime: 15_000,
  });

  const eligible = useMemo(
    () => grants.filter((g) => (kind === 'LEGAL' ? g.can_legal : g.can_repo)),
    [grants, kind],
  );
  const agentOptions = useMemo(
    () => eligible.map((g) => ({ value: String(g.user_id), label: g.full_name || g.username })),
    [eligible],
  );
  const selectedAgent = eligible.find((g) => String(g.user_id) === agentId) ?? null;

  const reset = () => {
    setView('form'); setAgentId(null); setKind('REPO');
    setError(null); setBusy(false); setResult(null); setConfirmClose(false);
  };

  const forceClose = () => { reset(); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (agentId) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (companyId == null || !selectedAgent) return;
    setBusy(true);
    setError(null);
    try {
      const res = await repoAuthorityIssue(companyId, selectedAgent.user_id, kind);
      setResult({
        agent: selectedAgent.full_name || selectedAgent.username,
        kind: res.kind,
        reused: !res.newly_issued,
      });
      setView('done');
      onIssued();
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  // The BE refuses to issue for an agent whose own profile lacks name /
  // national id / address, so say it here instead of letting the submit fail.
  const profileBlocked = !!selectedAgent && !selectedAgent.profile_complete;

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('repo.authority.issueTitle')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('repo.authority.issueTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'done' && result ? (
          <ActionDoneView
            headline={result.reused ? t('repo.authority.issueReused') : t('repo.authority.issueDone')}
            contractCode={result.agent}
            tone={result.reused ? 'neutral' : 'success'}
            detailRows={[
              { label: t('repo.authority.kind'), value: t(`repo.authority.kind_${result.kind}`, { defaultValue: result.kind }) },
            ]}
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="form-grid gap-3">
                <div className="flex flex-col">
                  <label className="form-label">{t('repo.authority.kind')} *</label>
                  <Select
                    options={KINDS.map((k) => ({ value: k, label: t(`repo.authority.kind_${k}`, { defaultValue: k }) }))}
                    value={kind}
                    onChange={(v) => { setKind((v as RepoAuthorityKind) || 'REPO'); setAgentId(null); }}
                    size="sm"
                    showChevron
                  />
                </div>
                <div className="flex flex-col">
                  <label className="form-label">{t('repo.authority.agent')} *</label>
                  <Select
                    options={agentOptions}
                    value={agentId}
                    onChange={(v) => setAgentId((v as string) || null)}
                    placeholder={t('repo.authority.agentPlaceholder')}
                    size="sm"
                    searchable
                    showChevron
                  />
                  {agentOptions.length === 0 && (
                    <p className="text-xs text-warning-fg mt-1">{t('repo.authority.noEligibleAgent')}</p>
                  )}
                </div>
                {profileBlocked && (
                  <div className="alert alert-warning">
                    <AlertTriangle size={16} />
                    <span className="alert-description">{t('repo.authority.agentProfileIncomplete')}</span>
                  </div>
                )}
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                variant="primary"
                startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                disabled={busy || !selectedAgent || profileBlocked}
                onClick={submit}
              >
                {t('repo.authority.issue')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Revoke ──────────────────────────────────────────────────────────────────
function VoidAuthorityModal({ open, onClose, row, onVoided }: {
  open: boolean;
  onClose: () => void;
  row: RepoAuthorityRow | null;
  onVoided: () => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<'form' | 'done'>('form');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // The parent clears its selection as it closes, so hold the last row through
  // the exit transition or the body blanks mid-animation.
  const [held, setHeld] = useState<RepoAuthorityRow | null>(row);
  if (row && row.authority_id !== held?.authority_id) setHeld(row);
  const shown = row ?? held;

  const reset = () => { setView('form'); setReason(''); setError(null); setBusy(false); setConfirmClose(false); };
  const forceClose = () => { reset(); onClose(); };
  const handleClose = () => {
    if (view === 'done') { forceClose(); return; }
    if (reason.trim()) { setConfirmClose(true); return; }
    forceClose();
  };

  const submit = async () => {
    if (!shown) return;
    setBusy(true);
    setError(null);
    try {
      await repoAuthorityVoid(shown.authority_id, reason.trim());
      setView('done');
      onVoided();
    } catch (err) {
      setError(apiErr(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal open={open} onClose={handleClose} maxWidth="28rem" width="100%" ariaLabel={t('repo.authority.voidTitle')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('repo.authority.voidTitle')}</h2>
          <button type="button" className="modal-close-btn" onClick={handleClose} aria-label={t('common.close')}>&times;</button>
        </div>

        {view === 'done' ? (
          <ActionDoneView
            headline={t('repo.authority.voidDone')}
            contractCode={shown?.agent_name || shown?.agent_username || ''}
            tone="warning"
            onClose={forceClose}
          />
        ) : (
          <>
            <div className="modal-content">
              <div className="flex flex-col gap-3">
                <div className="px-3 py-2.5 rounded-md bg-surface border border-line">
                  <div className="font-medium text-sm">{shown?.agent_name || shown?.agent_username || '—'}</div>
                  <div className="text-xs text-subtle">
                    {t(`repo.authority.kind_${shown?.kind ?? 'REPO'}`, { defaultValue: shown?.kind })}
                    {shown?.token_hint && <> · <span className="font-mono">{shown.token_hint}</span></>}
                  </div>
                </div>
                <p className="text-xs text-subtle">{t('repo.authority.voidHint')}</p>
                <div className="flex flex-col">
                  <label className="form-label">{t('repo.authority.voidReason')}</label>
                  <TextArea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('repo.authority.voidReasonPlaceholder')}
                  />
                </div>
              </div>
            </div>

            <ModalErrorBand message={error} onDismiss={() => setError(null)} />

            <div className="modal-footer">
              <Button variant="ghost" onClick={handleClose}>{t('common.cancel')}</Button>
              <Button
                color="danger"
                startIcon={busy ? <Loader2 size={16} className="animate-spin" /> : <Ban size={16} />}
                disabled={busy}
                onClick={submit}
              >
                {t('repo.authority.void')}
              </Button>
            </div>
          </>
        )}
      </Modal>

      <Modal open={confirmClose} onClose={() => setConfirmClose(false)} maxWidth="24rem" width="100%">
        <div className="modal-header"><h2 className="modal-title">{t('common.unsavedChanges')}</h2></div>
        <div className="modal-content"><p>{t('common.unsavedChangesMessage')}</p></div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setConfirmClose(false)}>{t('common.cancel')}</Button>
          <Button color="danger" onClick={forceClose}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </>
  );
}

// ── Blank-letter print ──────────────────────────────────────────────────────
function AuthorityPrintModal({ open, onClose, row }: {
  open: boolean;
  onClose: () => void;
  row: RepoAuthorityRow | null;
}) {
  const { t } = useTranslation();
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const authorityId = row?.authority_id ?? null;

  useEffect(() => {
    if (!open || authorityId == null) return;
    let cancelled = false;
    let createdUrl: string | null = null;
    setLoading(true);
    setErrMsg(null);
    setBlobUrl(null);

    beMediaRepoAuthorityPdfById(authorityId)
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch((err) => { if (!cancelled) setErrMsg(apiErr(err, t)); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [open, authorityId, t]);

  const close = () => {
    setBlobUrl(null);
    setErrMsg(null);
    onClose();
  };

  const download = () => {
    if (!blobUrl || !row) return;
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `${row.agent_username}-authority.pdf`;
    a.click();
  };

  return (
    <Modal
      open={open}
      onClose={close}
      width="100vw"
      height="100dvh"
      maxWidth="100vw"
      maxHeight="100dvh"
      ariaLabel={t('repo.authority.printTitle')}
    >
      <div className="modal-header">
        <h2 className="modal-title">
          {t('repo.authority.printTitle')}
          {row && <span className="ml-2 text-sm font-normal text-subtle">{row.agent_name || row.agent_username}</span>}
        </h2>
        <button type="button" className="modal-close-btn" onClick={close} aria-label={t('common.close')}>&times;</button>
      </div>

      <div className="modal-content" style={{ padding: 0, display: 'flex', flexDirection: 'column' }}>
        {loading && (
          <div className="flex items-center justify-center py-10 text-subtle">
            <Loader2 size={20} className="animate-spin mr-2" />
            <span>{t('common.loading')}</span>
          </div>
        )}
        {errMsg && !loading && (
          <div className="max-w-2xl mx-auto mt-8 alert alert-danger">
            <AlertTriangle size={16} />
            <span>{errMsg}</span>
          </div>
        )}
        {blobUrl && !loading && (
          <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
            <PdfCanvasViewer src={blobUrl} loadingText={t('common.loading')} />
          </div>
        )}
      </div>

      <div className="modal-footer">
        <Button onClick={close}>{t('common.close')}</Button>
        <Button color="primary" startIcon={<Printer size={16} />} disabled={!blobUrl || loading} onClick={download}>
          {t('common.download')}
        </Button>
      </div>
    </Modal>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
function AuthorityRow({ row, isAdmin, onPrint, onVoid }: {
  row: RepoAuthorityRow;
  isAdmin: boolean;
  onPrint: (r: RepoAuthorityRow, newTab: boolean) => void;
  onVoid: (r: RepoAuthorityRow) => void;
}) {
  const { t } = useTranslation();
  // Live but unverifiable is the state worth shouting about: the paper looks
  // fine and fails at the door.
  const toggleOff = row.is_live && !row.capability_on;

  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-8 h-8 rounded-full bg-surface-shallow flex items-center justify-center shrink-0">
        <User size={16} className="text-subtle" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{row.agent_name || row.agent_username}</span>
          <Badge color={row.kind === 'LEGAL' ? 'warning' : 'info'} size="xs">
            {t(`repo.authority.kind_${row.kind}`, { defaultValue: row.kind })}
          </Badge>
          {row.is_live
            ? <Badge color="success" size="xs">{t('repo.authority.live')}</Badge>
            : <Badge color="default" size="xs">{t('repo.authority.revoked')}</Badge>}
          {toggleOff && (
            <Tooltip content={t('repo.authority.toggleOffHint')} placement="top">
              <span className="inline-flex items-center gap-1 text-[11px] text-warning-fg">
                <AlertTriangle size={12} />{t('repo.authority.toggleOff')}
              </span>
            </Tooltip>
          )}
        </div>
        <div className="text-xs text-subtle truncate">
          {row.agent_username}
          <> · <span className="font-mono">{row.token_hint}</span></>
          <> · {t('repo.authority.issuedAt')} <DateTime value={row.issued_at} showTime={false} /></>
          {row.revoked_at && (
            <> · {t('repo.authority.revokedAt')} <DateTime value={row.revoked_at} showTime={false} /></>
          )}
        </div>
        {row.revoke_reason && (
          <div className="text-xs text-subtler truncate">{row.revoke_reason}</div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {/* Revoke first, print last: print is on EVERY row, so anchoring it at
            the end keeps it in the same place down the whole list. Leading with
            the conditional one instead would shift print left or right
            depending on the row, and the eye would have to hunt for it. */}
        {isAdmin && row.is_live && (
          <Tooltip content={t('repo.authority.void')} placement="top">
            <Button variant="outline" size="sm" color="danger" startIcon={<Ban size={14} />} onClick={() => onVoid(row)} />
          </Tooltip>
        )}
        <Tooltip content={t('repo.authority.printHint')} placement="top">
          <Button
            variant="outline"
            size="sm"
            startIcon={<Printer size={14} />}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onPrint(row, true); } }}
            onClick={(e) => onPrint(row, e.ctrlKey || e.metaKey)}
          />
        </Tooltip>
      </div>
    </div>
  );
}

export function RepoAuthorityPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { addSnackbar } = useSnackbarContext();
  const companyId = user?.company_id ?? null;
  const isAdmin = ADMIN_ROLES.includes(user?.role_code ?? '');

  const [issueOpen, setIssueOpen] = useState(false);
  const [voidRow, setVoidRow] = useState<RepoAuthorityRow | null>(null);
  const [printRow, setPrintRow] = useState<RepoAuthorityRow | null>(null);

  // In place by default; in a new tab on ctrl/cmd or middle click. Falls back to
  // in place if the browser blocks the tab. Shared helper — see the note on it.
  const openPrint = async (row: RepoAuthorityRow, newTab: boolean) => {
    if (!newTab) { setPrintRow(row); return; }
    const opened = await openPdfInNewTab(() => beMediaRepoAuthorityPdfById(row.authority_id));
    if (!opened) setPrintRow(row);
  };

  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const { data: authPage, isLoading, isFetching, error } = useQuery({
    queryKey: ['repo', 'authorities', companyId, pageIndex, pageSize],
    queryFn: () => fetchRepoAuthorities(companyId!, pageIndex + 1, pageSize),
    enabled: companyId != null,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  const rows = authPage?.data ?? [];
  const totalCount = authPage?.totalCount ?? 0;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['repo', 'authorities', companyId] });

  const afterVoid = () => {
    refresh();
    addSnackbar({
      message: <div className="alert alert-success"><CheckCircle size={16} /><span className="alert-description">{t('repo.authority.voidDone')}</span></div>,
      type: 'success',
    });
  };

  return (
    <>
      <MobileHeader className="mobile-header-bordered md:hidden">
        <div className="mobile-header-start">
          <button className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current" aria-label="Open menu" onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}>
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">{t('repo.authority.title')}</div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content responsive-dvh-mobile-header">
        <div className="flex-none mb-4 flex items-start gap-4">
          <div className="flex-1 min-w-0 max-md:hidden">
            <h1 className="heading-2">{t('repo.authority.title')}</h1>
            <p className="text-sm text-subtle mt-1">{t('repo.authority.description')}</p>
          </div>
          {isAdmin && (
            <Button
              variant="primary"
              startIcon={<Plus size={16} />}
              onClick={() => setIssueOpen(true)}
              className="ml-auto shrink-0"
            >
              {t('repo.authority.issue')}
            </Button>
          )}
        </div>

        <div className="alert alert-info mb-4">
          <ShieldCheck size={16} />
          <div className="alert-description">{t('repo.authority.hint')}</div>
        </div>

        {error && (
          <div className="alert alert-danger mb-4">
            <XCircle size={16} />
            <span className="alert-description">{apiErr(error, t)}</span>
          </div>
        )}

        {/* The shared table rather than a hand-rolled list: it owns the row
            dividers, the pager and keyboard navigation, and keeps this page
            consistent with every other list in the app. A letter carries too
            little to justify a detail panel, so this stays single-column. */}
        {isLoading ? (
          <div className="p-8 flex items-center justify-center text-subtle"><Loader2 size={24} className="animate-spin" /></div>
        ) : (
          <DataTable<RepoAuthorityRow>
            data={rows}
            renderRow={(row) => (
              <AuthorityRow
                row={row.original}
                isAdmin={isAdmin}
                onPrint={openPrint}
                onVoid={setVoidRow}
              />
            )}
            enablePagination
            pageIndex={pageIndex}
            pageSize={pageSize}
            pageSizeOptions={[15, 25, 50]}
            rowCount={totalCount}
            onPageChange={({ pageIndex: pi, pageSize: ps }) => { setPageIndex(pi); setPageSize(ps); }}
            className={`flex-1 min-h-0 padded-datatable ${isFetching ? 'opacity-60 transition-opacity' : 'transition-opacity'}`}
            noResults={<div className="p-8 text-center text-subtler text-sm">{t('repo.authority.empty')}</div>}
          />
        )}
      </div>

      <IssueAuthorityModal
        open={issueOpen}
        companyId={companyId}
        onClose={() => setIssueOpen(false)}
        onIssued={refresh}
      />
      <VoidAuthorityModal
        open={!!voidRow}
        row={voidRow}
        onClose={() => setVoidRow(null)}
        onVoided={afterVoid}
      />
      <AuthorityPrintModal
        open={!!printRow}
        row={printRow}
        onClose={() => setPrintRow(null)}
      />
    </>
  );
}
