import { Scale, Truck, Undo2 } from 'lucide-react';
import type { RepoState } from './queueApi';

/** Where a customer stands with the repo team (mig 1681 `repo_state`), shown over the head
 *  without a click: with the repo team · sent back by them · with legal. NONE draws nothing. */
export const REPO_LOOK: Record<Exclude<RepoState, 'NONE'>, { color: string; Icon: typeof Truck }> = {
  WITH_REPO: { color: '#ea580c', Icon: Truck },
  // The colour of the "ทีมยึดส่งกลับ" lane.
  RETURNED: { color: '#be185d', Icon: Undo2 },
  WITH_LEGAL: { color: '#334155', Icon: Scale },
};
