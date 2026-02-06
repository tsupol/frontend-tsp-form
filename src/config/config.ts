interface Config {
  apiUrl: string;
}

function loadConfig(): Config {
  return {
    apiUrl: getEnv('VITE_API_URL', 'http://czynet.dyndns.org:3000'),
  };
}

function getEnv(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

export const config = loadConfig();
