import { Route, Routes, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSideNav } from './AppSideNav';
import { useAuth } from './contexts/AuthContext';
import type { ReactNode } from 'react';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { DashboardPage } from './pages/DashboardPage';
import { UserPage } from './pages/UserPage';
import { RegisterLayout } from './pages/register/RegisterLayout';
import { Step1DeviceInfo } from './pages/register/Step1DeviceInfo';
import { Step2Scan } from './pages/register/Step2Scan';
import { Step3Status } from './pages/register/Step3Status';
import { EnrollmentPage } from './pages/EnrollmentPage';
import { EnrollRedirectPage } from './pages/EnrollRedirectPage';
import { HoldingSelectModal } from './components/HoldingSelectModal';
import { UsersPage } from './pages/UsersPage';
import { BrandsPage } from './pages/products/BrandsPage';
import { FamiliesPage } from './pages/products/FamiliesPage';
import { AttributesPage } from './pages/products/AttributesPage';
import { ModelsPage } from './pages/products/ModelsPage';
import { ProductsLayout } from './pages/products/ProductsLayout';
import { CallCenterLayout } from './pages/call-center/CallCenterLayout';
import { TicketQueuePage } from './pages/call-center/TicketQueuePage';
import { TicketDetailPage } from './pages/call-center/TicketDetailPage';

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

      {/* User profile */}
      <Route
        path="/admin/profile"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <UserPage />
            </AdminLayout>
          </ProtectedRoute>
        }
      />

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
        path="/admin/call-center/queue"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CallCenterLayout><TicketQueuePage /></CallCenterLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin/call-center/ticket/:id"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <CallCenterLayout><TicketDetailPage /></CallCenterLayout>
            </AdminLayout>
          </ProtectedRoute>
        }
      />

      {/* Registration flow */}
      <Route
        path="/admin/register"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <RegisterLayout />
            </AdminLayout>
          </ProtectedRoute>
        }
      >
        <Route index element={<Step1DeviceInfo />} />
        <Route path="scan" element={<Step2Scan />} />
        <Route path="status" element={<Step3Status />} />
      </Route>

      {/* Enrollment */}
      <Route
        path="/admin/enrollment"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <EnrollmentPage />
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
