import type { RepoActionCode } from './repoApi';
import type { NoteActionConfig } from './RepoNoteActionModal';

// Note-driven actions handled by the one reusable modal (keyed by action_code).
export const NOTE_ACTIONS: Partial<Record<RepoActionCode, NoteActionConfig>> = {
  REPO_ADD_NOTE: { rpc: 'ops_repo_add_note', keyStem: 'addNote', noteRequired: true, tone: 'neutral' },
  REPO_REVERT_ACTIVE: {
    rpc: 'ops_repo_revert_active', keyStem: 'revertActive', noteRequired: true, tone: 'success',
    transition: { from: 'WAIT_FOR_REPO', to: 'ACTIVE', toColor: 'success' },
  },
  LEGAL_FINISH: {
    rpc: 'ops_legal_finish', keyStem: 'legalFinish', noteRequired: true, tone: 'success', confirmColor: 'primary',
    transition: { from: 'WAIT_FOR_LEGAL', to: 'LEGAL_COMPLETED', toColor: 'success' },
  },
  LEGAL_RETURN_TO_REPO: {
    rpc: 'ops_legal_return_to_repo', keyStem: 'legalReturn', noteRequired: true, tone: 'warning',
    transition: { from: 'WAIT_FOR_LEGAL', to: 'WAIT_FOR_REPO', toColor: 'warning' },
  },
};

// The repo team sending a job back to the collectors from the yard (mig 1680): the reason is
// what the collector reads on the returned job, so the box says so. Whether a reason is needed
// and how long is the backend's call (it answers REASON_REQUIRED with params.min_length).
export const RETURN_TO_COLLECTOR: NoteActionConfig = {
  rpc: 'ops_repo_revert_active', keyStem: 'returnToCollector', noteRequired: false, noteByServer: true, tone: 'success',
  transition: { from: 'WAIT_FOR_REPO', to: 'ACTIVE', toColor: 'success' },
};
