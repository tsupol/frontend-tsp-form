import type { ResizeOptions } from 'tsp-form';

interface Config {
  apiUrl: string;
  uploadUrl: string;
  s3BaseUrl: string;
}

function loadConfig(): Config {
  return {
    apiUrl: getEnv('VITE_API_URL', 'https://czynet.dyndns.org'),
    uploadUrl: getEnv('VITE_UPLOAD_URL', 'https://misc.ecap.cc/api/v1'),
    s3BaseUrl: getEnv('VITE_S3_BASE_URL', 'https://nnf-system-bucket.s3.ap-southeast-1.amazonaws.com'),
  };
}

function getEnv(key: string, defaultValue: string): string {
  const value = import.meta.env[key];
  return value !== undefined && value !== '' ? value : defaultValue;
}

export const config = loadConfig();

// Shared resize presets
const RESIZE_SM = {
  maxWidth: 320, maxHeight: 320, quality: 0.8, format: 'webp', mode: 'contain',
} satisfies ResizeOptions;

const RESIZE_LG = {
  maxWidth: 1280, maxHeight: 1280, quality: 0.82, format: 'webp', mode: 'contain',
} satisfies ResizeOptions;

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

  assetPhoto: {
    entityType: 'ASSET',
    usageType: 'PHOTO',
    sizes: {
      sm: { resize: RESIZE_SM, path: (id: number, idx: number) => `uploads/assets/${id}/photo-${idx}-sm.webp` },
      lg: { resize: RESIZE_LG, path: (id: number, idx: number) => `uploads/assets/${id}/photo-${idx}-lg.webp` },
    },
  },

  repairBefore: {
    entityType: 'REPAIR_ORDER',
    usageType: 'BEFORE_REPAIR',
    sizes: {
      sm: { resize: RESIZE_SM, path: (id: number, idx: number) => `uploads/repairs/${id}/before-${idx}-sm.webp` },
      lg: { resize: RESIZE_LG, path: (id: number, idx: number) => `uploads/repairs/${id}/before-${idx}-lg.webp` },
    },
  },

  repairAfter: {
    entityType: 'REPAIR_ORDER',
    usageType: 'AFTER_REPAIR',
    sizes: {
      sm: { resize: RESIZE_SM, path: (id: number, idx: number) => `uploads/repairs/${id}/after-${idx}-sm.webp` },
      lg: { resize: RESIZE_LG, path: (id: number, idx: number) => `uploads/repairs/${id}/after-${idx}-lg.webp` },
    },
  },

  buybackCondition: {
    entityType: 'PO_LINE',
    usageType: 'BUYBACK_CONDITION',
    maxFiles: 5,
    sizes: {
      sm: { resize: RESIZE_SM, path: (poLineId: number, idx: number) => `uploads/buyback/${poLineId}/condition-${idx}-sm.webp` },
      lg: { resize: RESIZE_LG, path: (poLineId: number, idx: number) => `uploads/buyback/${poLineId}/condition-${idx}-lg.webp` },
    },
  },
} as const;
