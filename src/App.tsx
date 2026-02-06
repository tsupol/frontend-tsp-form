import { Route, Routes, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AppSideNav } from './AppSideNav';
import { useAuth } from './contexts/AuthContext';
import type { ReactNode } from 'react';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { UserPage } from './pages/UserPage';
import { RegisterLayout } from './pages/register/RegisterLayout';
import { Step1DeviceInfo } from './pages/register/Step1DeviceInfo';
import { Step2Scan } from './pages/register/Step2Scan';
import { Step3Status } from './pages/register/Step3Status';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <AppSideNav />
      <div className="flex-grow overflow-auto h-screen">
        {children}
      </div>
    </div>
  );
}

function App() {
  const { t } = useTranslation();
  const { isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg">
        <div className="text-fg opacity-50">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />

      {/* Admin routes */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <AdminLayout>
              <UserPage />
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

      {/* Catch-all redirect */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
