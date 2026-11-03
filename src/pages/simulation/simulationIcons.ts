import { ArrowLeftRight, Banknote, CircleCheck, Clock, Ellipsis, Wallet, type LucideIcon } from 'lucide-react';
import type { PileKey } from './simulationTypes';

export const PILE_ICON: Record<PileKey, LucideIcon> = {
  cash: Banknote,
  transfer: ArrowLeftRight,
  wallet: Wallet,
  other: Ellipsis,
  pending_payout: Clock,
  payout: CircleCheck,
};
