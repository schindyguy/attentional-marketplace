import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';

function brandKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function geoWithFlag(geo) {
  const flags = { 'United States': '🇺🇸', 'United Kingdom': '🇬🇧', 'Canada': '🇨🇦', 'Australia': '🇦🇺' };
  const flag = flags[geo] || '🌐';
  return `${flag} ${geo}`;
}

export async function handleFeatured(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { DB } = env;
  const url = new URL(request.url);
  const all = url.searchParams.get('all') === '1';

  const where = all
    ? `h.status = 'active'`
    : `h.featured = 1 AND h.status = 'active'`;

  const rows = await queryMany(DB,
    `SELECT h.*, p.name AS publisher_name
     FROM handles h
     LEFT JOIN publishers p ON p.id = h.publisher_id
     WHERE ${where}
     ORDER BY h.followers DESC`);

  // Group by brand_name
  const brands = new Map();
  for (const row of rows) {
    const key = brandKey(row.brand_name);
    if (!brands.has(key)) {
      brands.set(key, {
        brand_key:      key,
        brand_name:     row.brand_name,
        publisher_name: row.publisher_name,
        geography:      geoWithFlag(row.geography),
        categories:     JSON.parse(row.categories || '[]'),
        total_reach:    0,
        featured:       false,
        handles:        [],
      });
    }
    const brand = brands.get(key);
    brand.total_reach += row.followers;
    if (row.featured) brand.featured = true;
    brand.handles.push({
      id:               row.id,
      handle_name:      row.handle_name,
      platform:         row.platform,
      followers:        row.followers,
      profile_url:      row.profile_url,
      featured:         !!row.featured,
      custom_image_url: row.custom_image_url || null,
    });
    // Merge categories
    const cats = JSON.parse(row.categories || '[]');
    for (const c of cats) {
      if (!brand.categories.includes(c)) brand.categories.push(c);
    }
  }

  return json({ data: [...brands.values()] });
}
