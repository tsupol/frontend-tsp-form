import { useTranslation } from 'react-i18next';
import { ArrowRightFromLine, Palette, Sun, Moon, Monitor, Languages, Calendar, Check } from 'lucide-react';
import { MobileHeader, Switch } from 'tsp-form';
import { useTheme } from '../../contexts/ThemeContext';
import { useDateCalendar, setDateCalendar } from '../../lib/datePref';
import { DateTime } from '../../components/DateTime';

function ChoiceRow({ icon, label, selected, onClick }: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-colors cursor-pointer text-left border ${
        selected
          ? 'border-primary-fg bg-item-active-bg text-item-active-fg'
          : 'border-line bg-surface hover:bg-item-hover-bg'
      }`}
    >
      {icon && <span className="shrink-0 text-subtle">{icon}</span>}
      <span className="flex-1 min-w-0">{label}</span>
      {selected && <Check size={16} className="shrink-0 text-primary-fg" />}
    </button>
  );
}

export function AppearancePage() {
  const { t, i18n } = useTranslation();
  const { theme, setTheme } = useTheme();
  const calendar = useDateCalendar();
  const sampleIso = new Date().toISOString();

  return (
    <>
      <MobileHeader className="mobile-header-scrolled-shadow md:hidden">
        <div className="mobile-header-start">
          <button
            className="flex items-center justify-center w-nav h-nav cursor-pointer bg-transparent border-none text-current"
            aria-label="Open menu"
            onClick={() => window.dispatchEvent(new CustomEvent('sidemenu:open'))}
          >
            <ArrowRightFromLine size={18} />
          </button>
        </div>
        <div className="mobile-header-title mobile-header-title-truncate">
          {t('appearance.title')}
        </div>
        <div className="mobile-header-end w-nav" />
      </MobileHeader>

      <div className="page-content max-w-2xl">
        <div className="flex items-center gap-2 mb-6 max-md:hidden">
          <Palette size={20} />
          <h1 className="heading-2">{t('appearance.title')}</h1>
        </div>

        <div className="flex flex-col gap-6">
          {/* Theme */}
          <section className="border border-line bg-surface p-5 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Palette size={16} className="text-subtle" />
              <h2 className="font-medium">{t('theme.title')}</h2>
            </div>
            <div className="flex flex-col gap-2">
              <ChoiceRow icon={<Sun size={16} />} label={t('theme.light')} selected={theme === 'light'} onClick={() => setTheme('light')} />
              <ChoiceRow icon={<Moon size={16} />} label={t('theme.dark')} selected={theme === 'dark'} onClick={() => setTheme('dark')} />
              <ChoiceRow icon={<Monitor size={16} />} label={t('theme.system')} selected={theme === 'system'} onClick={() => setTheme('system')} />
            </div>
          </section>

          {/* Language */}
          <section className="border border-line bg-surface p-5 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Languages size={16} className="text-subtle" />
              <h2 className="font-medium">{t('language.title')}</h2>
            </div>
            <div className="flex flex-col gap-2">
              <ChoiceRow label={t('language.en')} selected={i18n.language === 'en'} onClick={() => i18n.changeLanguage('en')} />
              <ChoiceRow label={t('language.th')} selected={i18n.language === 'th'} onClick={() => i18n.changeLanguage('th')} />
            </div>
          </section>

          {/* Calendar */}
          <section className="border border-line bg-surface p-5 rounded-lg">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={16} className="text-subtle" />
              <h2 className="font-medium">{t('appearance.calendar')}</h2>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-sm font-medium">{t('appearance.buddhistCalendar')}</div>
                <div className="text-xs text-subtle mt-0.5">{t('appearance.buddhistCalendarDesc')}</div>
                {i18n.language === 'th' && (
                  <div className="text-xs text-subtle mt-2">
                    {t('appearance.preview')}: <DateTime value={sampleIso} showTime={false} />
                  </div>
                )}
              </div>
              <Switch
                checked={calendar === 'buddhist'}
                onChange={(e) => setDateCalendar(e.target.checked ? 'buddhist' : 'gregorian')}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
