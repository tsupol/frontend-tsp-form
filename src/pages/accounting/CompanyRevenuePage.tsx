import { RemittanceRevenueView } from './RemittanceRevenueView';

export function CompanyRevenuePage() {
  return (
    <RemittanceRevenueView
      titleKey="nav.companyRevenue"
      descriptionKey="accounting.revenue.description"
      viewEndpoint="/v_company_revenue"
    />
  );
}
