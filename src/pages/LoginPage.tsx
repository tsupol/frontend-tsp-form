import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Input, FormControlError } from 'tsp-form';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { ApiError } from '../lib/api';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

interface LoginFormData {
  username: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormData>({
    defaultValues: { username: '', password: '' },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsPending(true);
    setErrorMessage('');
    try {
      await login(data.username, data.password);
      navigate('/admin');
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

        <form onSubmit={handleSubmit(onSubmit)} className="grid gap-4">
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="username">
              {t('auth.username')}
            </label>
            <FormControlError error={errors.username}>
              <Input
                id="username"
                placeholder={t('auth.enterUsername')}
                {...register('username', { required: t('auth.usernameRequired') })}
              />
            </FormControlError>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium" htmlFor="password">
              {t('auth.password')}
            </label>
            <FormControlError error={errors.password}>
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder={t('auth.enterPassword')}
                endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                onEndIconClick={() => setShowPassword(!showPassword)}
                {...register('password', { required: t('auth.passwordRequired') })}
              />
            </FormControlError>
          </div>

          {errorMessage && (
            <div className="text-danger text-sm">{errorMessage}</div>
          )}

          <Button type="submit" variant="outline" disabled={isPending}>
            {isPending ? t('auth.loggingIn') : t('auth.login')}
          </Button>
        </form>
      </div>
    </div>
  );
}
