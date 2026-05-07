import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { useAuth } from '../contexts/AuthContext';

const BAR_HEIGHTS = [18, 26, 22, 36, 32, 50, 46, 64];
const BAR_COUNT = BAR_HEIGHTS.length;
const BAR_WIDTH = 8;
const BAR_GAP = 4;
const CHART_WIDTH = BAR_COUNT * BAR_WIDTH + (BAR_COUNT - 1) * BAR_GAP;
const CHART_BASELINE = 40;

export function HomePage() {
  const { t } = useTranslation();
  const { isAuthenticated } = useAuth();

  return (
    <div className="relative min-h-screen flex flex-col bg-bg">
      <header className="relative border-b border-line p-4">
        <div className="max-w-6xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <img src="/nnf-favicon.svg" alt="" className="w-8 h-8 rounded-md" />
            <h1 className="heading-2" style={{ transform: 'translateY(var(--text-shift-y, 0px))' }}>{t('public.title')}</h1>
          </div>
          <div className="flex gap-2 items-center">
            <LanguageSwitcher />
            <Link to={isAuthenticated ? '/admin' : '/login'}>
              <Button variant="outline" size="sm">{t('public.signIn')}</Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="relative flex-1 flex flex-col items-center justify-center px-4 py-6 gap-6">
        <section className="text-center max-w-2xl">
          <h2
            className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight"
            style={{ letterSpacing: '0.01em' }}
          >
            {t('public.headline')}
          </h2>
        </section>

        <div className="relative w-72 sm:w-80 md:w-96 aspect-square">
          <svg
            viewBox="-100 -100 200 200"
            className="absolute inset-0 w-full h-full"
            aria-hidden
          >
            <defs>
              <linearGradient id="bar-gradient" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#34D399" />
                <stop offset="100%" stopColor="#047857" />
              </linearGradient>
            </defs>

            <g transform={`translate(${-CHART_WIDTH / 2} 0)`}>
              <line
                x1={-6}
                y1={CHART_BASELINE}
                x2={CHART_WIDTH + 4}
                y2={CHART_BASELINE}
                stroke="currentColor"
                strokeWidth={1}
                className="text-line"
              />
              <line
                x1={-6}
                y1={CHART_BASELINE - 70}
                x2={-6}
                y2={CHART_BASELINE + 4}
                stroke="currentColor"
                strokeWidth={1}
                className="text-line"
              />

              {BAR_HEIGHTS.map((h, i) => {
                const x = i * (BAR_WIDTH + BAR_GAP);
                const delay = i * 0.12;
                return (
                  <rect
                    key={i}
                    x={x}
                    y={CHART_BASELINE - h}
                    width={BAR_WIDTH}
                    height={h}
                    rx={1.5}
                    fill="url(#bar-gradient)"
                    style={{
                      transformBox: 'fill-box',
                      transformOrigin: 'bottom',
                      animation: `bar-rise 4.5s ${delay}s cubic-bezier(0.22, 1, 0.36, 1) infinite`,
                    }}
                  />
                );
              })}
            </g>
          </svg>
          <style>{`
            @keyframes bar-rise {
              0% { transform: scaleY(0); opacity: 0; }
              8% { transform: scaleY(1); opacity: 1; }
              85% { transform: scaleY(1); opacity: 1; }
              95% { transform: scaleY(1); opacity: 0; }
              100% { transform: scaleY(0); opacity: 0; }
            }
          `}</style>
        </div>

        <section className="text-center">
          <p className="text-base sm:text-lg text-control-label font-light mb-2">
            {t('public.description')}
          </p>
          <p
            className="text-xs sm:text-sm text-control-label/80"
            style={{ letterSpacing: '0.08em' }}
          >
            {t('public.scope')}
          </p>
        </section>
      </main>
    </div>
  );
}
