import type { CardStatus } from './WorkspaceTypes';
import type { ContractServerState } from './useContractQuery';
import type { CustomerSummary } from './useCustomerSummary';
import type { ContractDocSummary } from './useContractDocuments';
import type { ContractSignatory } from './useContractSignatories';
import { getAge } from '../../../lib/format';

// ── Card status derivation ──────────────────────────────────────────────

export function getCardStatus(
  card: string,
  contract: ContractServerState | null | undefined,
  customer: CustomerSummary | null | undefined,
  docs: ContractDocSummary | null | undefined,
  coLessees: { count: number; allComplete: boolean },
  signatories?: ContractSignatory[] | null,
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
      const isMinor = customer?.dateOfBirth ? getAge(customer.dateOfBirth) < 18 : false;
      if (isMinor && coLessees.count === 0) return 'warning';
      if (coLessees.count === 0) return 'complete';
      if (coLessees.allComplete) return 'complete';
      return 'partial';
    }

    case 'documents':
      if (!contract?.id) return 'locked';
      if (!docs || !customer) return 'empty';
      if (customer.hasIdPhoto && docs.hasSignature) return 'complete';
      if (customer.hasIdPhoto || docs.hasSignature) return 'partial';
      return 'empty';

    case 'signatory': {
      if (!contract?.id) return 'locked';
      const list = signatories ?? [];
      const has = (s: 'LESSOR' | 'WITNESS_1' | 'WITNESS_2') => list.some(x => x.slot === s);
      const lessor = has('LESSOR');
      const w1 = has('WITNESS_1');
      const w2 = has('WITNESS_2');
      const count = (lessor ? 1 : 0) + (w1 ? 1 : 0) + (w2 ? 1 : 0);
      if (count === 3) return 'complete';
      if (count > 0) return 'partial';
      return 'empty';
    }

    default:
      return 'empty';
  }
}
