import type { CardStatus } from './WorkspaceTypes';
import type { ContractServerState } from './useContractQuery';
import type { CustomerSummary } from './useCustomerSummary';
import type { ContractDocSummary } from './useContractDocuments';
import { getAge } from '../../../lib/format';

// ── Card status derivation ──────────────────────────────────────────────

export function getCardStatus(
  card: string,
  contract: ContractServerState | null | undefined,
  customer: CustomerSummary | null | undefined,
  docs: ContractDocSummary | null | undefined,
  guarantors: { count: number; allComplete: boolean },
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
      if (
        customer.addresses.home && customer.addresses.work &&
        customer.contactCount > 0 && customer.referenceCount > 0
      ) return 'complete';
      return 'partial';

    case 'contactRef':
      if (!contract?.customer_id) return 'locked';
      if (!customer) return 'empty';
      if (customer.contactCount > 0 && customer.referenceCount > 0) return 'complete';
      if (customer.contactCount > 0 || customer.referenceCount > 0) return 'partial';
      return 'empty';

    case 'guarantor': {
      if (!contract?.customer_id) return 'locked';
      const isMinor = customer?.dateOfBirth ? getAge(customer.dateOfBirth) < 18 : false;
      if (isMinor && guarantors.count === 0) return 'warning';
      if (guarantors.count === 0) return 'complete';
      if (guarantors.allComplete) return 'complete';
      return 'partial';
    }

    case 'documents':
      if (!contract?.id) return 'locked';
      if (!docs || !customer) return 'empty';
      if (customer.hasIdPhoto && docs.hasSignature) return 'complete';
      if (customer.hasIdPhoto || docs.hasSignature || docs.evidenceCount > 0) return 'partial';
      return 'empty';

    default:
      return 'empty';
  }
}
