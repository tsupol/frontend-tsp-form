import { createContext, useContext, useRef, useState, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal, Button } from 'tsp-form';
import { useTranslation } from 'react-i18next';

interface NavGuardContextValue {
  /** Register a guard — returns cleanup function */
  setDirtyRef: (ref: React.MutableRefObject<boolean>) => void;
  /** Navigate with guard check — shows confirm if dirty */
  guardedNavigate: (path: string) => void;
}

const NavGuardContext = createContext<NavGuardContextValue | null>(null);

export function useNavGuard() {
  return useContext(NavGuardContext);
}

export function NavGuardProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const dirtyRef = useRef<React.MutableRefObject<boolean> | null>(null);
  const [pendingPath, setPendingPath] = useState<string | null>(null);

  const setDirtyRef = useCallback((ref: React.MutableRefObject<boolean>) => {
    dirtyRef.current = ref;
  }, []);

  const guardedNavigate = useCallback((path: string) => {
    if (dirtyRef.current?.current) {
      setPendingPath(path);
      return;
    }
    navigate(path);
  }, [navigate]);

  const confirmDiscard = () => {
    if (!pendingPath) return;
    if (dirtyRef.current) dirtyRef.current.current = false;
    navigate(pendingPath);
    setPendingPath(null);
  };

  return (
    <NavGuardContext.Provider value={{ setDirtyRef, guardedNavigate }}>
      {children}
      <Modal open={!!pendingPath} onClose={() => setPendingPath(null)} maxWidth="400px" ariaLabel={t('common.unsavedChanges')}>
        <div className="modal-header">
          <h2 className="modal-title">{t('common.unsavedChanges')}</h2>
          <button type="button" className="modal-close-btn" onClick={() => setPendingPath(null)} aria-label="Close">&times;</button>
        </div>
        <div className="modal-content">
          <p>{t('common.unsavedChangesMessage')}</p>
        </div>
        <div className="modal-footer">
          <Button variant="ghost" onClick={() => setPendingPath(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={confirmDiscard}>{t('common.discard')}</Button>
        </div>
      </Modal>
    </NavGuardContext.Provider>
  );
}
