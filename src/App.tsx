import { Route, Routes, Navigate, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSideNav } from './AppSideNav';
import { useAuth } from './contexts/AuthContext';
import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { wsClient } from './lib/api/ws';
import { setupStaffPush } from './lib/api/push';
import { useChatRealtimeSnackbars } from './hooks/useChatRealtimeSnackbars';
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
import { CallCenterPage } from './pages/call-center/CallCenterPage';
import { PricingLayout } from './pages/pricing/PricingLayout';
import { PricebookPage } from './pages/pricing/PricebookPage';
import { Fin1RatesPage } from './pages/pricing/Fin1RatesPage';
import { Fin2RatesPage } from './pages/pricing/Fin2RatesPage';
import { DiscountPoliciesPage } from './pages/pricing/DiscountPoliciesPage';
import { DealPartnerRatesPage } from './pages/pricing/DealPartnerRatesPage';
import { InventoryLayout } from './pages/inventory/InventoryLayout';
import { StockDashboardPage } from './pages/inventory/StockDashboardPage';
import { BranchStockPage } from './pages/inventory/BranchStockPage';
import { InternalUseStockPage } from './pages/inventory/InternalUseStockPage';
import { ReceivingPage } from './pages/inventory/ReceivingPage';
import { LotsPage } from './pages/inventory/LotsPage';
import { AssetsPage } from './pages/inventory/AssetsPage';
import { AssetSalesPage } from './pages/inventory/AssetSalesPage';
import { PurchaseOrdersPage } from './pages/inventory/PurchaseOrdersPage';
import { TransfersPage } from './pages/inventory/TransfersPage';
import { RepairsPage } from './pages/inventory/RepairsPage';
import { BuybackPage } from './pages/inventory/BuybackPage';
import { BuybackWizardPage } from './pages/inventory/BuybackWizardPage';
import { BarcodesPage } from './pages/inventory/BarcodesPage';
import { PriceCheckPage } from './pages/PriceCheckPage';
import { DunningTargetsPage } from './pages/legal/DunningTargetsPage';
import { StaffCommissionPage } from './pages/commission/StaffCommissionPage';
import { ApprovalsPage } from './pages/approvals/ApprovalsPage';
import { ChatPage } from './pages/chat/ChatPage';
import { NnfAppPage } from './pages/nnf-app/NnfAppPage';
import { PaymentSubmissionsPage } from './pages/PaymentSubmissionsPage';
import { ContractsLayout } from './pages/contracts/ContractsLayout';
import { ContractSearchPage } from './pages/contracts/ContractSearchPage';
import { SavingContractsPage } from './pages/contracts/SavingContractsPage';
import { DraftContractsPage } from './pages/contracts/DraftContractsPage';
import { PendingPairingPage } from './pages/contracts/PendingPairingPage';
import { DepositedDevicesPage } from './pages/contracts/DepositedDevicesPage';
import { LoanersOutPage } from './pages/contracts/LoanersOutPage';
import { PausedContractsPage } from './pages/contracts/PausedContractsPage';
import { PendingPaymentPage } from './pages/contracts/PendingPaymentPage';
import { ContractWizardPage } from './pages/contracts/ContractWizardPage';
import { CompanyLayout } from './pages/company/CompanyLayout';
import { CompanyConfigRoot } from './pages/company/CompanyConfigRoot';
import { CompanyConfigDetailPage } from './pages/company/CompanyConfigDetailPage';
import { BankAccountsPage } from './pages/company/BankAccountsPage';
import { HolidaysPage } from './pages/company/HolidaysPage';
import { DunningSystemPage } from './pages/dunning/DunningSystemPage';
import { CollectionsLayout } from './pages/collections/CollectionsLayout';
import { BranchOverviewPage } from './pages/collections/BranchOverviewPage';
import { TeamLoadPage } from './pages/collections/TeamLoadPage';
import { UnassignedContractsPage } from './pages/collections/UnassignedContractsPage';
import { UnassignableContractsPage } from './pages/collections/UnassignableContractsPage';
import { RepoLayout } from './pages/repo/RepoLayout';
import { RepoPoolPage } from './pages/repo/RepoPoolPage';
import { RepoGrantsPage } from './pages/repo/RepoGrantsPage';
import { TimelineOverviewPage } from './pages/collections/TimelineOverviewPage';
import { BlacklistPage } from './pages/company/BlacklistPage';
import { ICloudPoolPage } from './pages/company/ICloudPoolPage';
import { BranchPinPage } from './pages/company/BranchPinPage';
import { BranchFinanceModelsPage } from './pages/company/BranchFinanceModelsPage';
import { OwnerConfigPage } from './pages/company/OwnerConfigPage';
import { RepairChargeOwnerPage } from './pages/company/RepairChargeOwnerPage';
import { LessorsPage } from './pages/company/LessorsPage';
import { BranchSignersPage } from './pages/company/BranchSignersPage';
import { BranchesPage } from './pages/BranchesPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { HoldingsPage } from './pages/settings/HoldingsPage';
import { CompaniesPage } from './pages/settings/CompaniesPage';
import { PrinterSetupPage } from './pages/help/PrinterSetupPage';
import { NotificationPrefsPage } from './pages/settings/NotificationPrefsPage';
import { AppearancePage } from './pages/settings/AppearancePage';
import { MyAssetsPage } from './pages/settings/MyAssetsPage';
import { BranchWallpaperPage } from './pages/settings/BranchWallpaperPage';
import { HelpLayout } from './pages/help/HelpLayout';
import { UserGuidePage } from './pages/help/UserGuidePage';
import { CustomersPage } from './pages/customers/CustomersPage';
import { AccountingLayout } from './pages/accounting/AccountingLayout';
import { DayClosePage } from './pages/accounting/DayClosePage';
import { BranchBalancePage } from './pages/accounting/BranchBalancePage';
import { BillsPage } from './pages/accounting/BillsPage';
import { PaymentsPage } from './pages/accounting/PaymentsPage';
import { PaymentListPage } from './pages/accounting/PaymentListPage';
import { ReconcileItemPage } from './pages/accounting/ReconcileItemPage';
import { ReconcileChannelPage } from './pages/accounting/ReconcileChannelPage';
import { InstallmentCheckPage } from './pages/accounting/InstallmentCheckPage';
import { AuditFlagsPage } from './pages/accounting/AuditFlagsPage';
import { ReportsPage } from './pages/accounting/ReportsPage';
import { ContractsOpenedReportPage } from './pages/accounting/ContractsOpenedReportPage';
import { BranchExpenseLayout } from './pages/branch-expense/BranchExpenseLayout';
import { ExpenseEntriesPage } from './pages/branch-expense/ExpenseEntriesPage';
import { CategoriesPage as BranchExpenseCategoriesPage } from './pages/branch-expense/CategoriesPage';
import { ExpenseSummaryPage } from './pages/branch-expense/ExpenseSummaryPage';
import { RetailBillsPage } from './pages/retail/RetailBillsPage';
import { DevLayout } from './pages/dev/DevLayout';
import { DevSignaturePage } from './pages/dev/DevSignaturePage';
import { DevMediaPage } from './pages/dev/DevMediaPage';
import { DevCropPage } from './pages/dev/DevCropPage';
import { DevWatermarkPage } from './pages/dev/DevWatermarkPage';
import { DevBillPrintPage } from './pages/dev/DevBillPrintPage';
import { DevNotificationsPage } from './pages/dev/DevNotificationsPage';
import { DevTokensPage } from './pages/dev/DevTokensPage';
import { DevRemoveButtonsPage } from './pages/dev/DevRemoveButtonsPage';
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

function RealtimeBridge() {
  const { isAuthenticated } = useAuth();
  const navigate = useNavigate();

  // WebSocket: connect on auth, disconnect on logout.
  useEffect(() => {
    if (isAuthenticated) wsClient.connect();
    else wsClient.disconnect();
  }, [isAuthenticated]);

  // Web Push: defer 1.5s after auth so the permission prompt does not race
  // with login UX. Re-running is safe (backend upserts; permission API short-
  // circuits once granted).
  useEffect(() => {
    if (!isAuthenticated) return;
    const t = setTimeout(() => {
      setupStaffPush({ onNavigate: (path) => navigate(path) }).catch(() => {});
    }, 1500);
    return () => clearTimeout(t);
  }, [isAuthenticated, navigate]);

  // In-app chat notifier. Fires snackbar anywhere except inside the open
  // thread.
  useChatRealtimeSnackbars();

  return null;
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
    <RealtimeBridge />
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
      <Route path="/admin/settings/printer" element={<Navigate to="/admin/help/printer" replace />} />
      <Route
        path="/admin/settings/notifications"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><NotificationPrefsPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/appearance"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><AppearancePage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/my-assets"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><MyAssetsPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/settings/branch-wallpaper"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <SettingsLayout><BranchWallpaperPage /></SettingsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Help */}
      <Route path="/admin/help" element={<Navigate to="/admin/help/user-guide" replace />} />
      <Route
        path="/admin/help/user-guide"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <HelpLayout><UserGuidePage /></HelpLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/help/printer"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <HelpLayout><PrinterSetupPage /></HelpLayout>
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

      {/* Call Center (legacy path — redirect to Collections section) */}
      <Route path="/admin/call-center" element={<Navigate to="/admin/collections/calls" replace />} />

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
        path="/admin/inventory/internal-use"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><InternalUseStockPage /></InventoryLayout>
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
      <Route
        path="/admin/inventory/asset-sales/:saleId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><AssetSalesPage /></InventoryLayout>
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
        path="/admin/contracts/deposited/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><DepositedDevicesPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/loaners/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><LoanersOutPage /></ContractsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/contracts/paused/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractsLayout><PausedContractsPage /></ContractsLayout>
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
          <Route
            path="/dev/crop"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevCropPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/watermark"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevWatermarkPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/bill-print"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevBillPrintPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/notifications"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevNotificationsPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/tokens"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevTokensPage /></DevLayout>
                </AdminLayout>
              </ProtectedRoute>
            }
          />
          <Route
            path="/dev/remove-buttons"
            element={
              <ProtectedRoute>
                <AdminLayout>
                  <DevLayout><DevRemoveButtonsPage /></DevLayout>
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
              <ChatPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* NNF App — customer app-access console */}
      <Route
        path="/admin/nnf-app"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <NnfAppPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Legal (legacy paths — the old legal-case model was dropped BE-side
          (migs 845/846); legal work now lives in the Repo/Legal section) */}
      <Route path="/admin/legal/dunning" element={<Navigate to="/admin/collections/worklist" replace />} />
      <Route path="/admin/legal/cases/:caseId?" element={<Navigate to="/admin/repo/pool" replace />} />
      <Route path="/admin/collections/cases/:caseId?" element={<Navigate to="/admin/repo/pool" replace />} />

      {/* Collections — unified section (worklist / calls / cases / timeline / config) */}
      <Route
        path="/admin/collections/worklist"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><DunningTargetsPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/calls"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><CallCenterPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/branch-overview"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><BranchOverviewPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/team-load"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><TeamLoadPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/unassigned"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><UnassignedContractsPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/unassignable"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><UnassignableContractsPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/timeline"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><TimelineOverviewPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/collections/config"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CollectionsLayout><DunningSystemPage /></CollectionsLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Repo / Legal (ยึดเครื่อง / กฎหมาย) */}
      <Route path="/admin/repo" element={<Navigate to="/admin/repo/pool" replace />} />
      <Route
        path="/admin/repo/pool/:contractId?"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <RepoLayout><RepoPoolPage /></RepoLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/repo/grants"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <RepoLayout><RepoGrantsPage /></RepoLayout>
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
      {/* Legacy dunning paths — redirect to unified Collections config */}
      <Route path="/admin/company/dunning" element={<Navigate to="/admin/collections/config" replace />} />
      <Route path="/admin/dunning" element={<Navigate to="/admin/collections/config" replace />} />
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
        path="/admin/company/lessors"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><LessorsPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/finance-models"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BranchFinanceModelsPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/owner-config"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><OwnerConfigPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/repair-charge-owner"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><RepairChargeOwnerPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/company/signers"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CompanyLayout><BranchSignersPage /></CompanyLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      {/* Back-compat: old route → redirect to branch signers */}
      <Route path="/admin/company/signatories" element={<Navigate to="/admin/company/signers" replace />} />



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
        path="/admin/accounting/reports"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><ReportsPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/contracts-opened"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><ContractsOpenedReportPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/reconcile-item"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><ReconcileItemPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/reconcile-channel"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><ReconcileChannelPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/installment-check"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><InstallmentCheckPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/payments"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><PaymentsPage /></AccountingLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/accounting/payment-list"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <AccountingLayout><PaymentListPage /></AccountingLayout>
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

      {/* Branch expense (BM records, accountant rolls up) */}
      <Route
        path="/admin/branch-expense"
        element={<Navigate to="/admin/branch-expense/entries" replace />}
      />
      <Route
        path="/admin/branch-expense/entries"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <BranchExpenseLayout><ExpenseEntriesPage /></BranchExpenseLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branch-expense/categories"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <BranchExpenseLayout><BranchExpenseCategoriesPage /></BranchExpenseLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/branch-expense/summary"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <BranchExpenseLayout><ExpenseSummaryPage /></BranchExpenseLayout>
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
