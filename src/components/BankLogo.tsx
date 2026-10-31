// A bank's round logo, by its code in v_ref_banks.
//
// The 14 files live in public/banks/<code>.png (96px, from the open-source
// casperstack/thai-banks-logo set), named by our own bank codes — so CIMBT,
// UOBT and LHBANK, not the set's CIMB / UOB / LHB. An account with no bank code
// (typed in before the bank had to be picked from the list) or a bank the set
// doesn't have gets a plain building in a grey circle, so rows still line up.
// PROMPTPAY (mig 1553: a destination in v_ref_banks, not a bank) has its own
// mark in public/banks/PROMPTPAY.svg.

import { Landmark } from 'lucide-react';

const LOGO_CODES = new Set([
  'KBANK', 'SCB', 'KTB', 'BAY', 'BBL', 'TTB', 'GSB',
  'BAAC', 'GHB', 'KKP', 'CIMBT', 'UOBT', 'TISCO', 'LHBANK',
]);

export function BankLogo({ code, size = 20, className = '' }: {
  code: string | null | undefined;
  size?: number;
  className?: string;
}) {
  if (code && (LOGO_CODES.has(code) || code === 'PROMPTPAY')) {
    return (
      <img
        src={code === 'PROMPTPAY' ? '/banks/PROMPTPAY.svg' : `/banks/${code}.png`}
        width={size}
        height={size}
        alt=""
        aria-hidden
        className={`shrink-0 rounded-full ${className}`}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`shrink-0 rounded-full bg-surface-shallow border border-line inline-flex items-center justify-center text-subtler ${className}`}
      style={{ width: size, height: size }}
    >
      <Landmark size={Math.round(size * 0.55)} />
    </span>
  );
}
