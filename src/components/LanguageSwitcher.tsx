import { useTranslation } from 'react-i18next';
import { Button } from 'tsp-form';

export function LanguageSwitcher() {
  const { i18n } = useTranslation();

  const toggleLanguage = () => {
    const newLang = i18n.language === 'th' ? 'en' : 'th';
    i18n.changeLanguage(newLang);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleLanguage}
    >
      {i18n.language === 'th' ? 'EN' : 'TH'}
    </Button>
  );
}
