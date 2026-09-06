import { useAuth } from '../contexts/AuthContext';
import { useBranchType } from '../hooks/useBranchType';
import { PriceCheckPage } from './PriceCheckPage';
import { Fin1CalculatorPage } from './Fin1CalculatorPage';

// เช็คราคา is one page for everyone (OHM 09-06: "เรื่องเดียวกัน หน้าเดียวกัน"),
// but what it shows depends on who's asking:
//   - deal-partner branch → the FIN1 negotiation calculator (no FIN2, no %)
//   - everyone else → the pricebook quote table (FIN1 + FIN2)
// The backend scopes the data either way; this switch is UX, not security.
export function PriceCheckRoute() {
  const { user } = useAuth();
  const branchType = useBranchType();

  // Branch users hold until their branch type resolves — rendering the table
  // first and swapping to the calculator mid-glance reads as a glitch.
  if (user?.branch_id != null && branchType === null) return null;

  return branchType === 'DEAL_PARTNER' ? <Fin1CalculatorPage /> : <PriceCheckPage />;
}
