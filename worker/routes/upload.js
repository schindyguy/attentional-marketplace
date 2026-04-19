// POST /api/upload  — multipart/form-data with a single "file" field.
// Stores the file in the AVATARS R2 bucket under avatars/<random>.<ext>
// and returns { url } pointing at PUBLIC_R2_URL/<key>.
//
// Auth: none (admin panel is unauthenticated like the rest of the API).
// 5 MB max, image/* only.

import { json } from '../lib/cors.js';

const MAX_BYTES   = 5 * 1024 * 1024;
const ALLOWED_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function handleUpload(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!env.AVATARS)              return json({ error: 'AVATARS bucket not bound' }, 500);

  let form;
  try { form = await request.formData(); }
  catch { return json({ error: 'Invalid multipart body' }, 400); }

  const file = form.get('file');
  if (!file || typeof file === 'string') return json({ error: 'Missing file field' }, 400);
  if (file.size > MAX_BYTES)             return json({ error: 'File too large (5 MB max)' }, 413);

  const ext = ALLOWED_EXT[file.type];
  if (!ext) return json({ error: `Unsupported type: ${file.type}` }, 415);

  const id  = crypto.randomUUID();
  const key = `avatars/${id}.${ext}`;

  await env.AVATARS.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' },
  });

  const base = (env.PUBLIC_R2_URL || '').replace(/\/$/, '');
  if (!base) return json({ error: 'PUBLIC_R2_URL not configured' }, 500);
  return json({ url: `${base}/${key}`, key });
}
