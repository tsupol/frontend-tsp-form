interface Config {
  apiUrl: string;
  uploadUrl: string;
  s3BaseUrl: string;     // legacy AWS S3 (read-only — pre-migration files)
  r2PublicUrl: string;   // R2 public bucket base URL
}

function loadConfig(): Config {
  return {
    apiUrl: getEnv('VITE_API_URL', 'https://nnf.czynet.dev/'),
    uploadUrl: getEnv('VITE_UPLOAD_URL', 'https://miscgo.czynet.dev/api/v1'),
    s3BaseUrl: getEnv('VITE_S3_BASE_URL', 'https://nnf-system-bucket.s3.ap-southeast-1.amazonaws.com'),
    r2PublicUrl: getEnv('VITE_R2_PUBLIC_URL', 'https://pub-ec97c2bdb4564779b166762d78a98593.r2.dev'),
  };
}

function getEnv(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

export const config = loadConfig();
