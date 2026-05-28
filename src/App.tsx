import { Route, Routes, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSideNav } from './AppSideNav';
import { useAuth } from './contexts/AuthContext';
import type { ReactNode } from 'react';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { UserPage } from './pages/UserPage';
import { EnrollRedirectPage } from './pages/EnrollRedirectPage';
import { HoldingSelectModal } from './components/HoldingSelectModal';
import { UsersPage } from './pages/UsersPage';
import { BrandsPage } from './pages/products/BrandsPage';
import { FamiliesPage } from './pages/products/FamiliesPage';
import { AttributesPage } from './pages/products/AttributesPage';
import { ModelsPage } from './pages/products/ModelsPage';
import { ProductsLayout } from './pages/products/ProductsLayout';
import { TicketQueuePage } from './pages/call-center/TicketQueuePage';
import { PricingLayout } from './pages/pricing/PricingLayout';
import { PricebookPage } from './pages/pricing/PricebookPage';
import { Fin1RatesPage } from './pages/pricing/Fin1RatesPage';
import { Fin2RatesPage } from './pages/pricing/Fin2RatesPage';
import { DiscountPoliciesPage } from './pages/pricing/DiscountPoliciesPage';
import { DealPartnerRatesPage } from './pages/pricing/DealPartnerRatesPage';
import { InventoryLayout } from './pages/inventory/InventoryLayout';
import { StockDashboardPage } from './pages/inventory/StockDashboardPage';
import { BranchStockPage } from './pages/inventory/BranchStockPage';
import { ReceivingPage } from './pages/inventory/ReceivingPage';
import { LotsPage } from './pages/inventory/LotsPage';
import { AssetsPage } from './pages/inventory/AssetsPage';
import { PurchaseOrdersPage } from './pages/inventory/PurchaseOrdersPage';
import { TransfersPage } from './pages/inventory/TransfersPage';
import { RepairsPage } from './pages/inventory/RepairsPage';
import { BuybackPage } from './pages/inventory/BuybackPage';
import { BuybackWizardPage } from './pages/inventory/BuybackWizardPage';
import { BarcodesPage } from './pages/inventory/BarcodesPage';
import { PriceCheckPage } from './pages/PriceCheckPage';
import { LegalLayout } from './pages/legal/LegalLayout';
import { DunningTargetsPage } from './pages/legal/DunningTargetsPage';
import { LegalCasesPage } from './pages/legal/LegalCasesPage';
import { StaffCommissionPage } from './pages/commission/StaffCommissionPage';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage';
import { ChatInboxPage } from './pages/chat/ChatInboxPage';
import { ChatThreadPage } from './pages/chat/ChatThreadPage';
import { PaymentSubmissionsPage } from './pages/PaymentSubmissionsPage';
import { ContractsLayout } from './pages/contracts/ContractsLayout';
import { ContractSearchPage } from './pages/contracts/ContractSearchPage';
import { SavingContractsPage } from './pages/contracts/SavingContractsPage';
import { DraftContractsPage } from './pages/contracts/DraftContractsPage';
import { PendingPairingPage } from './pages/contracts/PendingPairingPage';
import { PendingPaymentPage } from './pages/contracts/PendingPaymentPage';
import { ContractWizardPage } from './pages/contracts/ContractWizardPage';
import { CompanyLayout } from './pages/company/CompanyLayout';
import { CompanyConfigRoot } from './pages/company/CompanyConfigRoot';
import { CompanyConfigDetailPage } from './pages/company/CompanyConfigDetailPage';
import { BankAccountsPage } from './pages/company/BankAccountsPage';
import { HolidaysPage } from './pages/company/HolidaysPage';
import { DunningConfigPage } from './pages/company/DunningConfigPage';
import { BlacklistPage } from './pages/company/BlacklistPage';
import { ICloudPoolPage } from './pages/company/ICloudPoolPage';
import { BranchPinPage } from './pages/company/BranchPinPage';
import { SignatoriesPage } from './pages/company/SignatoriesPage';
import { BranchesPage } from './pages/BranchesPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { HoldingsPage } from './pages/settings/HoldingsPage';
import { CompaniesPage } from './pages/settings/CompaniesPage';
import { PrinterSetupPage } from './pages/settings/PrinterSetupPage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';
import { DayClosePage } from './pages/accounting/DayClosePage';
import { DailyAccountingPage } from './pages/accounting/DailyAccountingPage';
import { CashFlowPage } from './pages/accounting/CashFlowPage';
import { BranchBalancePage } from './pages/accounting/BranchBalancePage';
import { HoldingRemittancePage } from './pages/accounting/HoldingRemittancePage';
import { CompanyRevenuePage } from './pages/accounting/CompanyRevenuePage';
import { BranchLedgerPage } from './pages/accounting/BranchLedgerPage';
import { BillsPage } from './pages/accounting/BillsPage';
import { AuditFlagsPage } from './pages/accounting/AuditFlagsPage';
import { RetailBillsPage } from './pages/retail/RetailBillsPage';
import { DevLayout } from './pages/dev/DevLayout';
import { DevSignaturePage } from './pages/dev/DevSignaturePage';
import { DevMediaPage } from './pages/dev/DevMediaPage';
import { isLocalDev } from './lib/devEnv';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AdminLayout({ children }: { children: ReactNode }) {
  const { needsHoldingSelect } = useAuth();
  if (needsHoldingSelect) return null;
  return (
    <div className="flex h-dvh">
      <AppSideNav />
      <div className="flex-grow w-full better-scroll">
        {children}
      </div>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const { isLoading, needsHoldingSelect, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="text-fg opacity-50">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <>
    <HoldingSelectModal open={isAuthenticated && needsHoldingSelect} />
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/enroll" element={<EnrollRedirectPage />} />

      {/* Dashboard */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <DashboardPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Settings — profile, holdings, companies */}
      <Route
        path="/admin/settings/profile"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><UserPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/holdings"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><HoldingsPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/companies"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><CompaniesPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/printer"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><PrinterSetupPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      {/* Redirect old profile path */}
      <Route path="/admin/profile" element={<Navigate to="/admin/settings/profile" replace />} />

      {/* Users */}
      <Route
        path="/admin/users"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <UsersPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Products */}
      <Route
        path="/admin/products/brands"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ProductsLayout><BrandsPage /></ProductsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/products/families"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ProductsLayout><FamiliesPage /></ProductsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/products/attributes"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ProductsLayout><AttributesPage /></ProductsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/products/models"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ProductsLayout><ModelsPage /></ProductsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/products/models/:modelId"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ProductsLayout><ModelsPage /></ProductsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Call Center */}
      <Route
        path="/admin/call-center"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <TicketQueuePage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Pricing */}
      <Route
        path="/admin/pricing/pricebook"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PricingLayout><PricebookPage /></PricingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pricing/fin1-rates"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PricingLayout><Fin1RatesPage /></PricingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pricing/fin2-rates"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PricingLayout><Fin2RatesPage /></PricingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pricing/discount-policies"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PricingLayout><DiscountPoliciesPage /></PricingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/pricing/discount-approvals"
        element={<Navigate to="/admin/approvals" replace />}
      />
      <Route
        path="/admin/commission/approvals"
        element={<Navigate to="/admin/approvals" replace />}
      />
      <Route
        path="/admin/pricing/deal-partner-rates"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PricingLayout><DealPartnerRatesPage /></PricingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Inventory */}
      <Route
        path="/admin/inventory/stock/:selection?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><StockDashboardPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/branch-stock"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><BranchStockPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/assets/:assetId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><AssetsPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/po/:poId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><PurchaseOrdersPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/receiving/:receiptId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><ReceivingPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/lots/:lotId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><LotsPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/transfers/:transferId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><TransfersPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/repairs/:repairId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><RepairsPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/buyback/new/:poId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><BuybackWizardPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/buyback/:poId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><BuybackPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/barcodes"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><BarcodesPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/admin/inventory/ready-to-sell" element={<Navigate to="/admin/inventory/assets?bucket=ON_HAND_AVAILABLE" replace />} />
      <Route path="/admin/inventory/ready-to-sell/:assetId" element={<Navigate to="/admin/inventory/assets" replace />} />
      <Route path="/admin/inventory/sale" element={<Navigate to="/admin/inventory/assets?bucket=ON_HAND_AVAILABLE" replace />} />
      <Route path="/admin/inventory/assets/sale" element={<Navigate to="/admin/inventory/assets?bucket=ON_HAND_AVAILABLE" replace />} />

      {/* Price Check */}
      <Route
        path="/admin/price-check"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PriceCheckPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Contracts */}
      <Route path="/admin/contracts" element={<Navigate to="/admin/contracts/search" replace />} />
      <Route
        path="/admin/contracts/search/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><ContractSearchPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/saving"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><SavingContractsPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/draft"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><DraftContractsPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/pending-pairing/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><PendingPairingPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/pending-payment/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><PendingPaymentPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/new/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><ContractWizardPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Dev sandbox — localhost only */}
      {isLocalDev() && (
        <>
          <Route path="/dev" element={<Navigate to="/dev/signature" replace />} />
          <Route
            path="/dev/signature"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevSignaturePage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/media"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevMediaPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
        </>
      )}

      {/* Customers */}
      <Route
        path="/admin/customers/:customerId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CustomersPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Staff Commission — moved under Company */}
      <Route
        path="/admin/commission/staff"
        element={<Navigate to="/admin/company/staff-commission" replace />}
      />
      <Route
        path="/admin/company/staff-commission"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><StaffCommissionPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/approvals"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ApprovalsPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/payment-submissions"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <PaymentSubmissionsPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Chat */}
      <Route
        path="/admin/chat"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ChatInboxPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/chat/:contractId"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ChatThreadPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Legal */}
      <Route
        path="/admin/legal/dunning"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <LegalLayout><DunningTargetsPage /></LegalLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/legal/cases/:caseId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <LegalLayout><LegalCasesPage /></LegalLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Company */}
      <Route
        path="/admin/company/branches"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BranchesPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/config"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><CompanyConfigRoot /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      >
        <Route path=":companyId" element={<CompanyConfigDetailPage />} />
      </Route>
      <Route
        path="/admin/company/bank-accounts"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BankAccountsPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/holidays"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><HolidaysPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/dunning"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><DunningConfigPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/blacklist"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BlacklistPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/icloud"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><ICloudPoolPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/pin"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BranchPinPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/signatories"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><SignatoriesPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />



      {/* Retail */}
      <Route path="/admin/retail" element={<Navigate to="/admin/retail/bills" replace />} />
      <Route
        path="/admin/retail/bills"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <RetailBillsPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Accounting */}
      <Route
        path="/admin/accounting/day-close"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><DayClosePage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/day-close/:branchId/:date"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><DayClosePage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/bills/:billId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><BillsPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/daily"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><DailyAccountingPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/cashflow"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><CashFlowPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/ledger"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><BranchLedgerPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/balance"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><BranchBalancePage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/remittance"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><HoldingRemittancePage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/revenue"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><CompanyRevenuePage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/audit-flags"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><AuditFlagsPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

export default App;
