import { useLocation, useNavigate } from 'react-router-dom';
import { RouteTransition, useRouteTransition } from 'tsp-form';
import { CompanyConfigPage } from './CompanyConfigPage';
import { CompanyConfigDetailPage } from './CompanyConfigDetailPage';

// ── Bridge hook: direction signaling + React Router navigate ─────────────────

export function useTransitionNavigate() {
  const navigate = useNavigate();
  const { goForward, goBack } = useRouteTransition();

  return {
    forward: (path: string) => { goForward(); navigate(path); },
    back: (path: string) => { goBack(); navigate(path); },
  };
}

// ── Route resolver ───────────────────────────────────────────────────────────

function ResolveRoute() {
  const location = useLocation();
  const match = location.pathname.match(/^\/admin\/company\/config\/(\d+)$/);
  if (match) {
    return <CompanyConfigDetailPage />;
  }
  return <CompanyConfigPage />;
}

// ── Root wrapper with transition ─────────────────────────────────────────────

export function CompanyConfigRoot() {
  const location = useLocation();

  return (
    <RouteTransition locationKey={location.pathname + location.search}>
      <ResolveRoute />
    </RouteTransition>
  );
}
