import { AnimatedOutlet } from 'tsp-form';
import { CompanyConfigPage } from './CompanyConfigPage';

export function CompanyConfigRoot() {
  return (
    <AnimatedOutlet fallback={<CompanyConfigPage />} />
  );
}
