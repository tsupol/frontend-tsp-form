import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { PageNav, PageNavPanel, MobileHeader, Badge, Button, Modal, useSnackbarContext } from 'tsp-form';
import { ArrowLeft, ArrowRightFromLine, CheckCircle } from 'lucide-react';
import { codeDisplay } from './inventoryUtils';
import { useNavGuard } from '../../contexts/NavGuardContext';
import { useBuybackDraft, useBuybackActions, getSetupStatus, getConditionStatus, getSubmitStatus } from './buybackWizard/useBuyback';
import { CardSetup } from './buybackWizard/CardSetup';
import { CardCondition } from './buybackWizard/CardCondition';
import { CardPhotos } from './buybackWizard/CardPhotos';
import { CardSubmit } from './buybackWizard/CardSubmit';
import { PanelSetup } from './buybackWizard/PanelSetup';
import { PanelCondition } from './buybackWizard/PanelCondition';
import { PanelPhotos } from './buybackWizard/PanelPhotos';
import { PanelSubmit } from './buybackWizard/PanelSubmit';
import type { WizardSection } from './buybackWizard/types';

export function BuybackWizardPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addSnackbar } = useSnackbarContext();
  const { poId: poIdParam } = useParams<{ poId?: string }>();
  const poId = poIdParam ? Number(poIdParam) : null;

  const { data: draft, invalidate } = useBuybackDraft(poId);
  const { data: actionsResp } = useBuybackActions(poId);
  const navGuard = useNavGuard();

  // Dirty ref — Panels mutate, NavGuard reads it for sidebar nav, the wizard
  // reads it for in-page card switching and beforeunload.
  const dirtyRef = useRef(false);
  useEffect(() => { navGuard?.setDirtyRef(dirtyRef); }, [navGuard]);

  // Pending in-page nav (clicked another card with unsaved edits).
  // Action 'close' means user tried to close the edit panel.
  const [pendingNav, setPendingNav] = useState<{ kind: 'section'; section: WizardSection } | { kind: 'close' } | null>(null);

  // beforeunload — browser-level guard
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, []);

  // No draft yet → open Setup immediately. With a poId we wait for the draft
  // to load, then auto-open Setup on first load (Continue Draft entry).
  const [openSection, setOpenSection] = useState<WizardSection | null>(poId ? null : 'setup');
  const initialOpenedRef = useRef(false);

  useEffect(() => {
    if (initialOpenedRef.current) return;
    if (!poId) {
      if (!draft) setOpenSection('setup');
      initialOpenedRef.current = true;
      return;
    }
    // poId present → wait for draft to load, then auto-open Setup if still editable.
    if (draft) {
      if (draft.status === 'DRAFT') setOpenSection('setup');
      initialOpenedRef.current = true;
    }
  }, [poId, draft]);

  const setupStatus = getSetupStatus(draft);
  const conditionStatus = getConditionStatus(draft);
  const submitStatus = getSubmitStatus(draft, setupStatus, conditionStatus, actionsResp);

  const sectionTitle: Record<WizardSection, string> = {
    setup: t('buybackWizard.cardSetup', { defaultValue: 'Setup' }),
    condition: t('buybackWizard.cardCondition', { defaultValue: 'Condition' }),
    photos: t('buybackWizard.cardPhotos', { defaultValue: 'Photos' }),
    submit: t('buybackWizard.cardSubmit', { defaultValue: 'Submit' }),
  };

  const isReadOnly = !!draft && draft.status !== 'DRAFT';

  return (
    <PageNav panels={['summary', 'edit']} defaultPanel="summary" className="h-dvh">
      {({ isMobile, isRoot, goTo, goBack }) => {
        const doOpen = (id: WizardSection) => {
          setOpenSection(id);
          if (isMobile) goTo('edit');
        };
        const doClose = () => {
          setOpenSection(null);
          if (isMobile) goBack();
        };
        const handleOpen = (id: WizardSection) => {
          if (openSection === id) return;
          if (dirtyRef.current) { setPendingNav({ kind: 'section', section: id }); return; }
          doOpen(id);
        };
        const handleClose = () => {
          if (dirtyRef.current) { setPendingNav({ kind: 'close' }); return; }
          doClose();
        };
        const confirmPendingNav = () => {
          if (!pendingNav) return;
          dirtyRef.current = false;
          if (pendingNav.kind === 'section') doOpen(pendingNav.section);
          else doClose();
          setPendingNav(null);
        };
        const cancelPendingNav = () => setPendingNav(null);
        const isCardActive = (id: WizardSection) => openSection === id && !(isMobile && isRoot);

        return (
          <>
            {isMobile && (
              <MobileHeader className="mobile-header-bordered">
                <div className="mobile-header-start">
                  {isRoot ? (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
                    >
                      <ArrowRightFromLine size={18} />
                    </button>
                  ) : (
                    <button
                      className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
                      onClick={handleClose}
                    >
                      <ArrowLeft size={20} />
                    </button>
                  )}
                </div>
                <div className="mobile-header-title mobile-header-title-truncate">
                  {isRoot
                    ? t('nav.newBuyback')
                    : openSection
                      ? sectionTitle[openSection]
                      : t('nav.newBuyback')}
                </div>
                <div className="mobile-header-end min-w-nav">
                  {draft?.code_display && (
                    <Badge size="sm" color="default" className="font-mono mr-2">{codeDisplay(draft.code_display, draft.po_no)}</Badge>
                  )}
                </div>
              </MobileHeader>
            )}

            {!isMobile && (
              <div className="flex-none px-4 py-2.5 border-b border-line flex items-center gap-4">
                <h1 className="heading-2 shrink-0">{t('nav.newBuyback')}</h1>
                {draft?.code_display && (
                  <Badge size="sm" color="default" className="font-mono">{codeDisplay(draft.code_display, draft.po_no)}</Badge>
                )}
                {isReadOnly && (
                  <Badge size="sm" color="info">{draft.status}</Badge>
                )}
                <div className="flex-1" />
                {draft && (
                  <Button size="sm" variant="outline" onClick={() => navigate(`/admin/inventory/buyback/${draft.po_id}`)}>
                    {t('buybackWizard.viewDetail', { defaultValue: 'View detail' })}
                  </Button>
                )}
              </div>
            )}

            <div className={isMobile ? 'pagenav-panels' : 'flex flex-1 min-h-0'}>
              <PageNavPanel id="summary" className={isMobile ? '' : 'w-5/12 xl:w-4/12 min-w-0 border-r border-line flex flex-col'}>
                <div className="flex-1 overflow-y-auto better-scroll">
                  <div className="p-4 flex flex-col gap-3">
                    <CardSetup draft={draft ?? null} active={isCardActive('setup')} onEdit={() => handleOpen('setup')} />
                    <CardCondition draft={draft ?? null} active={isCardActive('condition')} onEdit={() => handleOpen('condition')} />
                    <CardPhotos draft={draft ?? null} active={isCardActive('photos')} onEdit={() => handleOpen('photos')} />
                    <CardSubmit
                      draft={draft ?? null}
                      status={submitStatus}
                      active={isCardActive('submit')}
                      onEdit={() => handleOpen('submit')}
                    />
                  </div>
                </div>
              </PageNavPanel>

              <PageNavPanel id="edit" className={isMobile ? '' : 'flex-1 flex flex-col min-w-0 overflow-hidden'}>
                {openSection === 'setup' && (
                  <PanelSetup
                    draft={draft ?? null}
                    dirtyRef={dirtyRef}
                    onClose={handleClose}
                    onSaved={(newPoId) => {
                      dirtyRef.current = false;
                      invalidate();
                      if (!poId) {
                        navigate(`/admin/inventory/buyback/new/${newPoId}`, { replace: true });
                      }
                      addSnackbar({
                        message: (
                          <div className="alert alert-success">
                            <CheckCircle size={16} />
                            <span>{t('buybackWizard.savedSetup', { defaultValue: 'Setup saved' })}</span>
                          </div>
                        ),
                      });
                    }}
                  />
                )}
                {openSection === 'condition' && draft && (
                  <PanelCondition
                    draft={draft}
                    dirtyRef={dirtyRef}
                    onClose={handleClose}
                    onSaved={() => {
                      dirtyRef.current = false;
                      invalidate();
                      addSnackbar({
                        message: (
                          <div className="alert alert-success">
                            <CheckCircle size={16} />
                            <span>{t('buybackWizard.savedCondition', { defaultValue: 'Condition saved' })}</span>
                          </div>
                        ),
                      });
                    }}
                  />
                )}
                {openSection === 'photos' && draft && (
                  <PanelPhotos
                    draft={draft}
                    onClose={handleClose}
                  />
                )}
                {openSection === 'submit' && draft && (
                  <PanelSubmit
                    draft={draft}
                    onClose={handleClose}
                    onSubmitted={() => {
                      invalidate();
                      handleClose();
                      addSnackbar({
                        message: (
                          <div className="alert alert-success">
                            <CheckCircle size={16} />
                            <span>{t('buyback.submitSuccess')}</span>
                          </div>
                        ),
                      });
                      navigate(`/admin/inventory/buyback/${draft.po_id}`);
                    }}
                  />
                )}
                {!openSection && !isMobile && (
                  <div className="flex items-center justify-center h-full text-subtle text-sm">
                    {t('buybackWizard.selectToEdit', { defaultValue: 'Click a card to edit.' })}
                  </div>
                )}
              </PageNavPanel>
            </div>

            {/* Confirm discard for in-page card switching */}
            <Modal open={!!pendingNav} onClose={cancelPendingNav} maxWidth="400px" ariaLabel={t('common.unsavedChanges')}>
              <div className="modal-header">
                <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
                <button type="button" className="modal-close-btn" onClick={cancelPendingNav} aria-label="Close">&times;</button>
              </div>
              <div className="modal-content">
                <p>{t('common.unsavedChangesMessage')}</p>
              </div>
              <div className="modal-footer">
                <Button variant="ghost" onClick={cancelPendingNav}>{t('common.cancel')}</Button>
                <Button color="danger" onClick={confirmPendingNav}>{t('common.discard')}</Button>
              </div>
            </Modal>
          </>
        );
      }}
    </PageNav>
  );
}
