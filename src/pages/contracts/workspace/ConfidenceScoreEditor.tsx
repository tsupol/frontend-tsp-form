// Customer confidence rating (1–5 stars). Staff rates customer risk; the
// score is a validate_ready prerequisite, so it lives in the Documents step
// alongside the other readiness items. Writes via
// fn_contract_set_staff_confidence_score and invalidates the shared
// ['contract-readiness', id] cache so the why-not-ready alert clears at once.

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Star, Loader2, XCircle } from 'lucide-react';
import { apiClient, ApiError } from '../../../lib/api';
import { useWorkspace } from './WorkspaceContext';

const SCORE_TOOLTIPS: Record<number, string> = {
  1: 'workspace.score1',
  2: 'workspace.score2',
  3: 'workspace.score3',
  4: 'workspace.score4',
  5: 'workspace.score5',
};

export function ConfidenceScoreEditor() {
  const { t } = useTranslation();
  const { data, contract, invalidateContract } = useWorkspace();
  const queryClient = useQueryClient();

  const [pendingScore, setPendingScore] = useState<number | null>(null);
  const serverScore = contract?.staff_confidence_score ?? null;
  const score = pendingScore ?? serverScore;
  useEffect(() => {
    if (serverScore != null && serverScore === pendingScore) setPendingScore(null);
  }, [serverScore, pendingScore]);

  const [scoreSaving, setScoreSaving] = useState(false);
  const [scoreError, setScoreError] = useState('');
  const [hoverStar, setHoverStar] = useState(0);

  const handleSetScore = async (n: number) => {
    if (!data.contractId) return;
    setScoreSaving(true);
    setScoreError('');
    setPendingScore(n);
    try {
      await apiClient.rpc('fn_contract_set_staff_confidence_score', {
        p_contract_id: data.contractId,
        p_score: n,
      });
      invalidateContract();
      // Readiness depends on the score — refetch so the blocker alert updates.
      queryClient.invalidateQueries({ queryKey: ['contract-readiness', data.contractId] });
    } catch (err) {
      setPendingScore(null);
      if (err instanceof ApiError) {
        const tr = (err.messageKey ? t(err.messageKey, { ns: 'apiErrors', defaultValue: '' }) : '')
          || (err.code ? t(err.code, { ns: 'apiErrors', defaultValue: '' }) : '');
        setScoreError(tr || err.message);
      } else {
        setScoreError(String(err));
      }
    } finally {
      setScoreSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold text-subtle uppercase tracking-wider">
        {t('workspace.confidenceLabel')}
      </h3>
      <div className="flex items-center gap-1" onMouseLeave={() => setHoverStar(0)}>
        {[1, 2, 3, 4, 5].map(n => {
          const filled = n <= (hoverStar || score || 0);
          return (
            <button
              key={n}
              className="p-1 cursor-pointer bg-transparent border-none transition-transform hover:scale-110"
              onClick={() => handleSetScore(n)}
              onMouseEnter={() => setHoverStar(n)}
              disabled={scoreSaving}
              title={t(SCORE_TOOLTIPS[n])}
            >
              <Star size={28} className={filled ? 'text-warning-fg fill-warning' : 'text-fg/20'} />
            </button>
          );
        })}
        {scoreSaving && <Loader2 size={16} className="animate-spin text-subtle ml-2" />}
      </div>

      {(hoverStar > 0 || score) && (
        <div className="text-xs text-subtle">
          {t(SCORE_TOOLTIPS[hoverStar || score || 3])}
        </div>
      )}

      {scoreError && (
        <div className="alert alert-danger mt-1">
          <XCircle size={14} />
          <span>{scoreError}</span>
        </div>
      )}
    </div>
  );
}
