import { useState, useEffect, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormErrorMessage, Select } from 'tsp-form';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

interface LoginFormData {
  username: string;
  password: string;
}

const TEST_USERS = [
  { label: 'alice (SYSTEM_DEV)', value: 'alice' },
  { label: 'test_holding_admin (HOLDING_ADMIN)', value: 'test_holding_admin' },
  { label: 'test_company_admin (COMPANY_ADMIN)', value: 'test_company_admin' },
  { label: 'test_branch_manager (BRANCH_MANAGER)', value: 'test_branch_manager' },
  { label: 'test_branch_sale (BRANCH_SALE)', value: 'test_branch_sale' },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const reasonRef = useRef(searchParams.get('reason'));
  const errorCodeRef = useRef(searchParams.get('error_code'));
  const errorMsgRef = useRef(searchParams.get('error_msg'));

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
    defaultValues: { username: 'alice', password: 'alice123' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsPending(true);
    setErrorMessage('');
    try {
      const result = await login(data.username, data.password);
      navigate(result.needsHoldingSelect ? '/admin/select-holding' : '/admin');
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === '28000' || err.message === 'invalid_login') {
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
    <div className="flex min-h-screen items-center justify-center bg-bg">
      <div className="w-full max-w-md p-card">
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-2xl font-bold">{t('auth.login')}</h1>
          <LanguageSwitcher />
        </div>

        {reasonRef.current === 'session_expired' && (
          <div className="mb-4 p-3 bg-warning/10 border border-warning/30 rounded text-sm text-warning">
            <div>{t('auth.sessionExpired')}</div>
            {errorCodeRef.current && (
              <div className="mt-1 text-xs opacity-75">
                [{errorCodeRef.current}] {errorMsgRef.current}
              </div>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="form-label">Quick login</label>
          <Select
            options={TEST_USERS}
            value="alice"
            onChange={(val) => {
              setValue('username', val);
              setValue('password', val === 'alice' ? 'alice123' : 'Test123456');
            }}
            searchable={false}
            showChevron
          />
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
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
            <div className="text-danger text-sm">{errorMessage}</div>
          )}

          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? t('auth.loggingIn') : t('auth.login')}
          </Button>

          <div className="text-center text-sm">
            <Link to="/" className="text-primary hover:underline">
              {t('nav.home')}
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
