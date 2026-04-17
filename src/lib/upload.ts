import { config } from '../config/config';

export async function uploadToS3(file: File, key: string): Promise<string> {
  const form = new FormData();
  form.append('file', file);
  form.append('key', key);

  const res = await fetch(`${config.uploadUrl}/upload/s3`, { method: 'POST', body: form });
  const json = await res.json();
  if (!json.success) throw new Error(json.error?.message ?? 'Upload failed');
  return json.data.key;
}

export async function deleteFromS3(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  // Keys stored in DB have leading slash, S3 keys don't
  const cleaned = keys.map(k => k.replace(/^\//, ''));
  await fetch(`${config.uploadUrl}/delete/s3`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: cleaned }),
  });
}
