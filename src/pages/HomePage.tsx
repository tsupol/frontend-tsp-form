import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAuth } from '../contexts/AuthContext';

export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="heading-2">{t('public.welcome')}</h1>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            {isAuthenticated ? (
              <Link to="/admin">
                <Button variant="outline" size="sm">{t('nav.userArea')}</Button>
              </Link>
            ) : (
              <Link to="/login">
                <Button variant="outline" size="sm">{t('auth.login')}</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <section className="py-12 text-center">
          <h2 className="text-2xl font-semibold mb-4">{t('public.title')}</h2>
          <p className="text-control-label">{t('public.description')}</p>
        </section>
      </main>
    </div>
  );
}
