import type { CardStatus } from './WorkspaceTypes';
import type { ContractServerState } from './useContractQuery';
import type { CustomerSummary } from './useCustomerSummary';
import type { ContractDocSummary } from './useContractDocuments';
import type { ContractSignatory } from './useContractSignatories';
import { getAge, ADULT_AGE } from '../../../lib/format';

// ── Card status derivation ──────────────────────────────────────────────

export function getCardStatus(
  card: string,
  contract: ContractServerState | null | undefined,
  customer: CustomerSummary | null | undefined,
  docs: ContractDocSummary | null | undefined,
  coLessees: { count: number; allComplete: boolean },
  signatories?: ContractSignatory[] | null,
  branchHasLessorDefault?: boolean,
): CardStatus {
  switch (card) {
    case 'productPlan':
      // Complete = has rate set (server truth via set_rate)
      if (contract?.value_month != null && contract?.installment_amount != null) return 'complete';
      if (contract?.model_id) return 'partial';
      return 'empty';

    case 'customer':
      if (!contract?.customer_id) return 'empty';
      if (!customer) return 'partial';
      if (customer.addresses.home && customer.addresses.work) return 'complete';
      return 'partial';

    case 'contactRef':
      if (!contract?.customer_id) return 'locked';
      if (!customer) return 'empty';
      if (customer.contactCount > 0 && customer.referenceCount > 0) return 'complete';
      if (customer.contactCount > 0 || customer.referenceCount > 0) return 'partial';
      return 'empty';

    case 'co_lessee': {
      if (!contract?.customer_id) return 'locked';
      const isMinor = customer?.dateOfBirth ? getAge(customer.dateOfBirth) < ADULT_AGE : false;
      if (isMinor && coLessees.count === 0) return 'warning';
      if (coLessees.count === 0) return 'complete';
      if (coLessees.allComplete) return 'complete';
      return 'partial';
    }

    case 'documents':
      // Signature is no longer captured at draft — the customer signs on the
      // capture bridge after the snapshot. The draft document requirement is the
      // ID card only.
      if (!contract?.id) return 'locked';
      if (!docs || !customer) return 'empty';
      return customer.hasIdPhoto ? 'complete' : 'empty';

    case 'signatory': {
      // Witnesses are chosen at signing time now (mig 345/346), not at draft.
      // Only LESSOR matters here — and contract-open auto-binds the branch
      // default lessor (mig 350/351), so a configured branch default is enough.
      if (!contract?.id) return 'locked';
      const list = signatories ?? [];
      const lessorBound = list.some(x => x.slot === 'LESSOR');
      if (lessorBound || branchHasLessorDefault) return 'complete';
      return 'empty';
    }

    default:
      return 'empty';
  }
}
