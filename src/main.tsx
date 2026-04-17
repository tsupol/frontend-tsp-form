import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ModalProvider, SnackbarProvider } from 'tsp-form';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { NavGuardProvider } from './contexts/NavGuardContext';
import { queryClient } from './lib/queryClient';
import App from './App';
import './i18n/config';
import './index.css';
import './styles/typography.css';
import './styles/layout.css';
import './app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <SnackbarProvider defaults={{ position: 'top-right' }}>
            <ModalProvider>
              <BrowserRouter>
                <NavGuardProvider>
                  <App />
                </NavGuardProvider>
              </BrowserRouter>
            </ModalProvider>
          </SnackbarProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
