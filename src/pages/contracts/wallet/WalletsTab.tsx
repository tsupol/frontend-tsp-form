import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnackbarContext } from 'tsp-form';
import { CheckCircle } from 'lucide-react';
import { WalletCard } from './WalletCard';
import { WalletActionModal } from './WalletActionModal';
import type { WalletType, WalletAction } from './types';
import { useCompanyFeatures, type CompanyFeatureCode } from '../../../hooks/useCompanyFeatures';

interface ContractForWallets {
  id: number;
  code: string;
  code_display: string | null;
  holding_id: number;
  company_id: number;
  state: string;
  saving_balance: number | null;
  credit_balance: number | null;
  credit_balance_company: number | null;
  credit_balance_holding: number | null;
  insurance_balance: number | null;
  paid_installment_count: number | null;
  total_installments: number | null;
}

interface WalletsTabProps {
  contract: ContractForWallets;
}

const WALLET_ORDER: WalletType[] = ['SAVING', 'CREDIT', 'INSURANCE'];

export function WalletsTab({ contract }: WalletsTabProps) {
  const { t } = useTranslation();
  const { addSnackbar } = useSnackbarContext();
  const features = useCompanyFeatures(contract.company_id);
  // Hide a wallet the company has turned off. WALLET_ORDER codes match feature
  // codes 1:1. Server also blocks disabled-wallet money, this just removes the
  // dead-end button.
  const visibleWallets = WALLET_ORDER.filter(w => features.isEnabled(w as CompanyFeatureCode));
  const [activeAction, setActiveAction] = useState<{
    walletType: WalletType;
    action: WalletAction;
  } | null>(null);

  const handleSuccess = (msgKey: string) => {
    setActiveAction(null);
    addSnackbar({
      message: (
        <div className="alert alert-success">
          <CheckCircle size={16} />
          <span>{t(msgKey)}</span>
        </div>
      ),
    });
  };

  return (
    <div className="p-4 flex flex-col gap-4">
      {visibleWallets.length === 0 && (
        <div className="p-6 text-center text-subtler text-sm">{t('wallet.allDisabled', { defaultValue: 'No wallets enabled for this company' })}</div>
      )}
      {visibleWallets.map(walletType => (
        <WalletCard
          key={walletType}
          contract={contract}
          walletType={walletType}
          onAction={action => setActiveAction({ walletType, action })}
        />
      ))}

      <WalletActionModal
        open={!!activeAction}
        onClose={() => setActiveAction(null)}
        onSuccess={handleSuccess}
        contractId={contract.id}
        contractCode={contract.code_display ?? contract.code}
        holdingId={contract.holding_id}
        walletType={activeAction?.walletType ?? 'SAVING'}
        action={activeAction?.action ?? 'DEPOSIT'}
      />

    </div>
  );
}
