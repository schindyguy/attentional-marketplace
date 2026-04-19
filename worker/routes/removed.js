import { queryMany, queryOne } from '../lib/db.js';
import { json } from '../lib/cors.js';

export async function handleRemoved(request, env, url) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { DB } = env;

  const page   = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
  const limit  = Math.min(100, parseInt(url.searchParams.get('limit') || '25'));
  const offset = (page - 1) * limit;
  const q      = url.searchParams.get('q');

  const where  = [`h.status IN ('removed','paused')`];
  const params = [];
  if (q) { where.push('(h.brand_name LIKE ? OR h.handle_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }

  const wc       = `WHERE ${where.join(' AND ')}`;
  const countRow = await queryOne(DB, `SELECT COUNT(*) AS n FROM handles h ${wc}`, params);
  const total    = countRow.n;

  const rows = await queryMany(DB,
    `SELECT h.*, p.name AS publisher_name
     FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
     ${wc}
     ORDER BY h.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]);

  return json({
    data: rows.map(r => ({ ...r, categories: JSON.parse(r.categories || '[]'), featured: r.featured === 1 })),
    meta: { total, page, limit, pages: Math.ceil(total / limit) },
  });
}
