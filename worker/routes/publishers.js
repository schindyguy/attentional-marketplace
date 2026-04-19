import { queryMany, queryOne, run } from '../lib/db.js';
import { json } from '../lib/cors.js';
import { validatePublisher } from '../lib/validate.js';

export async function handlePublishers(request, env, url) {
  const { DB } = env;
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const id    = parts[3] ? parseInt(parts[3]) : null;

  if (request.method === 'GET') {
    if (id) {
      const pub = await queryOne(DB, `SELECT * FROM publishers WHERE id = ?`, [id]);
      if (!pub) return json({ error: 'Not found' }, 404);
      const handles = await queryMany(DB,
        `SELECT * FROM handles WHERE publisher_id = ? ORDER BY followers DESC`, [id]);
      return json({ ...pub, handles: handles.map(h => ({ ...h, categories: JSON.parse(h.categories || '[]'), featured: h.featured === 1 })) });
    }

    const page   = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
    const limit  = Math.min(100, parseInt(url.searchParams.get('limit') || '25'));
    const offset = (page - 1) * limit;
    const q      = url.searchParams.get('q');
    const status = url.searchParams.get('status');

    const where  = [];
    const params = [];
    if (q)      { where.push('p.name LIKE ?'); params.push(`%${q}%`); }
    if (status) { where.push('p.status = ?'); params.push(status); }
    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await queryOne(DB, `SELECT COUNT(*) AS n FROM publishers p ${wc}`, params);
    const total    = countRow.n;

    const rows = await queryMany(DB,
      `SELECT p.*,
              COUNT(h.id)       AS handle_count,
              COALESCE(SUM(CASE WHEN h.status='active' THEN h.followers ELSE 0 END), 0) AS total_reach
       FROM publishers p
       LEFT JOIN handles h ON h.publisher_id = p.id
       ${wc}
       GROUP BY p.id
       ORDER BY total_reach DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]);

    return json({ data: rows, meta: { total, page, limit, pages: Math.ceil(total / limit) } });
  }

  if (request.method === 'POST') {
    const body = await request.json();
    const err  = validatePublisher(body);
    if (err) return json({ error: err }, 400);

    const result = await run(DB,
      `INSERT INTO publishers (name, website, geography, primary_category, status, cover_image_url, notes)
       VALUES (?,?,?,?,?,?,?)`,
      [body.name.trim(), body.website || null, body.geography || 'United States',
       body.primary_category || null, body.status || 'active',
       body.cover_image_url || null, body.notes || null]);

    return json({ id: result.meta.last_row_id }, 201);
  }

  if (request.method === 'PUT' && id) {
    const body    = await request.json();
    const allowed = ['name','website','geography','primary_category','status','cover_image_url','notes'];
    const sets    = [];
    const params  = [];

    for (const key of allowed) {
      if (!(key in body)) continue;
      sets.push(`${key} = ?`);
      params.push(body[key]);
    }

    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await run(DB, `UPDATE publishers SET ${sets.join(', ')} WHERE id = ?`, params);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
