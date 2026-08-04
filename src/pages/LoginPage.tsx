import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormErrorMessage } from 'tsp-form';
import { Eye, EyeOff, AlertTriangle, CheckCircle } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { QuickLogin } from '../components/QuickLogin';
import { translateApiError } from '../lib/apiErrors';

interface LoginFormData {
  username: string;
  password: string;
}


export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [showQuickLogin, setShowQuickLogin] = useState(
    () => localStorage.getItem('quickLoginVisible') === '1',
  );

  const toggleQuickLogin = () => {
    setShowQuickLogin((prev) => {
      const next = !prev;
      localStorage.setItem('quickLoginVisible', next ? '1' : '0');
      return next;
    });
  };

  const reasonRef = useRef(searchParams.get('reason'));
  const errorCodeRef = useRef(searchParams.get('error_code'));
  const errorMsgRef = useRef(searchParams.get('error_msg'));

  // Turn the raw redirect params into a human sentence. The backend hands us an
  // uppercase code (e.g. AUTH.AUTH.SESSION_TAKEN_OVER); the apiErrors catalog keys
  // some codes lowercase, so try the code as-is, then lowercased, before falling
  // back. Never render the bare "[CODE] English message" — that leaked to users.
  const sessionEndedCode = reasonRef.current === 'session_expired' ? errorCodeRef.current : null;
  const isTakenOver = sessionEndedCode === 'AUTH.AUTH.SESSION_TAKEN_OVER';
  const sessionEndedReason = (() => {
    if (!sessionEndedCode) return '';
    const translated =
      t(sessionEndedCode, { ns: 'apiErrors', defaultValue: '' }) ||
      t(sessionEndedCode.toLowerCase(), { ns: 'apiErrors', defaultValue: '' });
    if (translated) return translated;
    // Taken-over has its own dedicated hint below — don't fall back to raw English.
    if (isTakenOver) return '';
    // Last resort for an untranslated code: the backend's own message beats a bare
    // title, but never the "[CODE] English" dump we used to show.
    return errorMsgRef.current ?? '';
  })();

  useEffect(() => {
    if (reasonRef.current) {
      searchParams.delete('reason');
      searchParams.delete('error_code');
      searchParams.delete('error_msg');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: { username: '', password: 'Test123456' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsPending(true);
    setErrorMessage('');
    try {
      const result = await login(data.username, data.password);
      if (!result.needsHoldingSelect) {
        navigate('/admin');
      }
      // If holding selection is needed, the modal in App handles it
    } catch (err) {
      if (err instanceof ApiError) {
        const translated = translateApiError(err, t);
        if (translated) {
          setErrorMessage(translated);
        } else if (err.code === '28000' || err.message === 'invalid_login') {
          setErrorMessage(t('auth.invalidCredentials'));
        } else {
          setErrorMessage(err.message);
        }
      } else {
        setErrorMessage(t('auth.loginFailed'));
      }
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="h-dvh flex flex-col bg-bg sm:bg-surface overflow-hidden">
      <header className="px-4 sm:px-8 pt-6 sm:pt-8 pb-2 flex justify-center sm:justify-start">
        <div className="flex items-center gap-3">
          <img src="/nnf-favicon.svg" alt="" className="w-8 h-8 rounded-md" />
          <h1 className="heading-2" style={{ transform: 'translateY(var(--text-shift-y, 0px))' }}>{t('public.title')}</h1>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center px-4 py-6 sm:py-10">
        <div className="w-full max-w-md p-6 sm:p-10 md:p-12 sm:border sm:border-line sm:bg-bg sm:rounded-xl sm:shadow-sm">
          <div className="flex justify-between items-center mb-10">
            <h2 className="heading-1">{t('auth.login')}</h2>
            <LanguageSwitcher />
          </div>

        {reasonRef.current === 'password_changed' && (
          <div className="alert alert-success mb-8">
            <CheckCircle size={18} />
            <div>
              <div className="alert-title">{t('auth.passwordChangedTitle')}</div>
              <div className="alert-description mt-0.5">{t('auth.passwordChangedHint')}</div>
            </div>
          </div>
        )}

        {reasonRef.current === 'session_expired' && (
          <div className="alert alert-warning mb-8">
            <AlertTriangle size={18} />
            <div>
              <div className="alert-title">
                {isTakenOver ? t('auth.sessionTakenOverTitle') : t('auth.sessionExpired')}
              </div>
              {(sessionEndedReason || (isTakenOver && t('auth.sessionTakenOverHint'))) && (
                <div className="alert-description mt-0.5">
                  {sessionEndedReason || t('auth.sessionTakenOverHint')}
                </div>
              )}
            </div>
          </div>
        )}

        {showQuickLogin && (
          <QuickLogin
            onSelect={(username, password) => {
              setValue('username', username);
              setValue('password', password);
            }}
          />
        )}

        <form onSubmit={handleSubmit(onSubmit)} className="mt-8">
          <div className="grid gap-7 pb-10">
            <div className="flex flex-col">
              <label className="form-label" htmlFor="username">
                {t('auth.username')}
              </label>
              <Input
                id="username"
                placeholder={t('auth.enterUsername')}
                error={!!errors.username}
                {...register('username', { required: t('auth.usernameRequired') })}
              />
              <FormErrorMessage error={errors.username} />
            </div>

            <div className="flex flex-col">
              <label className="form-label" htmlFor="password">
                {t('auth.password')}
              </label>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t('auth.enterPassword')}
                error={!!errors.password}
                endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPassword(!showPassword)}
                {...register('password', { required: t('auth.passwordRequired') })}
              />
              <FormErrorMessage error={errors.password} />
            </div>

            {errorMessage && (
              <div className="alert alert-danger">
                <div className="alert-description">{errorMessage}</div>
              </div>
            )}
          </div>

          <div className="flex justify-center">
            <Button type="submit" color="primary" size="lg" disabled={isPending} className="px-14">
              {isPending ? t('auth.loggingIn') : t('auth.login')}
            </Button>
          </div>
        </form>
        </div>
      </div>

      <button
        type="button"
        aria-label=""
        title=""
        onClick={toggleQuickLogin}
        className="fixed bottom-0 right-0 w-4 h-4 bg-line/40 hover:bg-line/60 cursor-default focus:outline-none"
        tabIndex={-1}
      />
    </div>
  );
}
