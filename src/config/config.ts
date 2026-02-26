import type { ResizeOptions } from 'tsp-form';

interface Config {
  apiUrl: string;
  uploadUrl: string;
  s3BaseUrl: string;
}

function loadConfig(): Config {
  return {
    apiUrl: getEnv('VITE_API_URL', 'https://czynet.dyndns.org'),
    uploadUrl: getEnv('VITE_UPLOAD_URL', 'https://misc.ecap.cc/api/api/v1'),
    s3BaseUrl: getEnv('VITE_S3_BASE_URL', 'https://nnf-system-bucket.s3.ap-southeast-1.amazonaws.com'),
  };
}

function getEnv(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

export const config = loadConfig();

export const imageConfig = {
  userProfile: {
    resize: {
      maxWidth: 320,
      maxHeight: 320,
      quality: 0.8,
      format: 'webp',
      aspectRatio: 1,
      mode: 'cover',
      cropPosition: 'center',
    } satisfies ResizeOptions,
    dbKey: 'sm' as const,
    path: (userId: number | string) => `uploads/users/${userId}/profile-sm.webp`,
  },
} as const;
