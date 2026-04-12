import { RemittanceRevenueView } from './RemittanceRevenueView';

export function HoldingRemittancePage() {
  return (
    <RemittanceRevenueView
      titleKey="nav.holdingRemittance"
      descriptionKey="accounting.remittance.description"
      viewEndpoint="/v_holding_remittance"
    />
  );
}
