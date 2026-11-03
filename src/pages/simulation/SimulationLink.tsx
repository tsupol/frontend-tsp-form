import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Map as MapIcon } from 'lucide-react';
import { useMyPermissions } from '../../hooks/useMyPermissions';
import { SIMULATION_PATH, SIMULATION_PERMISSION } from './simulationTypes';

/** The dashboard button (156 §1). A real link, so ctrl/middle click opens a new tab. No permission = nothing at all. */
export function SimulationLink() {
  const { t } = useTranslation();
  const { hasPermission } = useMyPermissions();
  if (!hasPermission(SIMULATION_PERMISSION)) return null;
  return (
    <Link to={SIMULATION_PATH} className="btn btn-outline-default btn-sm inline-flex items-center gap-2 no-underline shrink-0" data-testid="simulation-link">
      <MapIcon size={14} />
      {t('simulation.title')}
    </Link>
  );
}
