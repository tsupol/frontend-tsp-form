interface Config {
  apiUrl: string;
}

function loadConfig(): Config {
  return {
    apiUrl: getEnv('VITE_API_URL', 'https://czynet.dyndns.org'),
  };
}

function getEnv(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

export const config = loadConfig();
