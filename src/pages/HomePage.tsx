import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { usePublicData } from '../hooks/usePublicData';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAuth } from '../contexts/AuthContext';

export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();
  const { data: publicItems, isLoading, error } = usePublicData();

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-line p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold">{t('public.welcome')}</h1>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            {isAuthenticated ? (
              <Link to="/admin">
                <Button variant="outline" size="compact">{t('nav.admin')}</Button>
              </Link>
            ) : (
              <Link to="/login">
                <Button variant="outline" size="compact">{t('public.loginAsAdmin')}</Button>
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-4">
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">{t('products.title')}</h2>

          {isLoading && (
            <div className="text-fg opacity-50">{t('common.loading')}</div>
          )}

          {error && (
            <div className="text-danger">{t('common.error')}</div>
          )}

          {publicItems && publicItems.length === 0 && (
            <div className="text-fg opacity-50">{t('products.noProducts')}</div>
          )}

          {publicItems && publicItems.length > 0 && (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {publicItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 border border-line rounded-lg bg-surface"
                >
                  <div className="text-sm text-fg opacity-50">#{item.id}</div>
                  <div className="mt-2">{item.msg}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
