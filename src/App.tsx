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
import { DiscountApprovalsPage } from './pages/pricing/DiscountApprovalsPage';
import { DealPartnerRatesPage } from './pages/pricing/DealPartnerRatesPage';
import { InventoryLayout } from './pages/inventory/InventoryLayout';
import { StockDashboardPage } from './pages/inventory/StockDashboardPage';
import { ReceivingPage } from './pages/inventory/ReceivingPage';
import { SalePage } from './pages/inventory/SalePage';
import { AssetsPage } from './pages/inventory/AssetsPage';
import { PurchaseOrdersPage } from './pages/inventory/PurchaseOrdersPage';
import { TransfersPage } from './pages/inventory/TransfersPage';
import { RepairsPage } from './pages/inventory/RepairsPage';
import { BuybackPage } from './pages/inventory/BuybackPage';
import { PriceCheckPage } from './pages/PriceCheckPage';
import { LegalLayout } from './pages/legal/LegalLayout';
import { DunningTargetsPage } from './pages/legal/DunningTargetsPage';
import { LegalCasesPage } from './pages/legal/LegalCasesPage';
import { CommissionLayout } from './pages/commission/CommissionLayout';
import { StaffCommissionPage } from './pages/commission/StaffCommissionPage';
import { NegotiationApprovalsPage } from './pages/commission/NegotiationApprovalsPage';
import { ContractsLayout } from './pages/contracts/ContractsLayout';
import { ContractSearchPage } from './pages/contracts/ContractSearchPage';
import { SavingContractsPage } from './pages/contracts/SavingContractsPage';
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
import { BranchesPage } from './pages/BranchesPage';
import { SettingsLayout } from './pages/settings/SettingsLayout';
import { HoldingsPage } from './pages/settings/HoldingsPage';
import { CompaniesPage } from './pages/settings/CompaniesPage';
import { CustomersPage } from './pages/customers/CustomersPage';

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
        element={<Navigate to="/admin/commission/approvals" replace />}
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
        path="/admin/inventory/stock"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><StockDashboardPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/assets"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><AssetsPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/po"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><PurchaseOrdersPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/receiving"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><ReceivingPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/transfers"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><TransfersPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/repairs"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><RepairsPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/buyback"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><BuybackPage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/inventory/sale"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <InventoryLayout><SalePage /></InventoryLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

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
        path="/admin/contracts/new"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <ContractWizardPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Customers */}
      <Route
        path="/admin/customers"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CustomersPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Commission */}
      <Route
        path="/admin/commission/staff"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CommissionLayout><StaffCommissionPage /></CommissionLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/commission/approvals"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CommissionLayout><NegotiationApprovalsPage /></CommissionLayout>
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



      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}

export default App;
