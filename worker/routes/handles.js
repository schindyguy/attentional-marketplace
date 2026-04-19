import { queryMany, queryOne, run } from '../lib/db.js';
import { json } from '../lib/cors.js';
import { validateHandle } from '../lib/validate.js';

function parseHandle(row) {
  if (!row) return null;
  return { ...row, categories: JSON.parse(row.categories || '[]'), featured: row.featured === 1 };
}

export async function handleHandles(request, env, url) {
  const { DB } = env;
  const parts = url.pathname.replace(/\/$/, '').split('/');
  const id = parts[3] ? parseInt(parts[3]) : null;

  // GET /api/handles or GET /api/handles/:id
  if (request.method === 'GET') {
    if (id) {
      const row = await queryOne(DB,
        `SELECT h.*, p.name AS publisher_name
         FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
         WHERE h.id = ?`, [id]);
      if (!row) return json({ error: 'Not found' }, 404);
      return json(parseHandle(row));
    }

    const page     = Math.max(1, parseInt(url.searchParams.get('page')  || '1'));
    const limit    = Math.min(100, parseInt(url.searchParams.get('limit') || '25'));
    const offset   = (page - 1) * limit;
    const status   = url.searchParams.get('status')       || 'active';
    const platform = url.searchParams.get('platform');
    const pubId    = url.searchParams.get('publisher_id');
    const geo      = url.searchParams.get('geo');
    const q        = url.searchParams.get('q');
    const featured = url.searchParams.get('featured');

    const where = [];
    const params = [];

    if (status !== 'all') { where.push('h.status = ?'); params.push(status); }
    if (platform)         { where.push('h.platform = ?'); params.push(platform); }
    if (pubId)            { where.push('h.publisher_id = ?'); params.push(parseInt(pubId)); }
    if (geo)              { where.push('h.geography LIKE ?'); params.push(`%${geo}%`); }
    if (q)                { where.push('(h.brand_name LIKE ? OR h.handle_name LIKE ?)'); params.push(`%${q}%`, `%${q}%`); }
    if (featured === 'true') { where.push('h.featured = 1'); }

    const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const countRow = await queryOne(DB, `SELECT COUNT(*) AS n FROM handles h ${wc}`, params);
    const total    = countRow.n;

    const rows = await queryMany(DB,
      `SELECT h.*, p.name AS publisher_name
       FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
       ${wc}
       ORDER BY h.featured DESC, h.followers DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]);

    return json({
      data: rows.map(parseHandle),
      meta: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  }

  // POST /api/handles
  if (request.method === 'POST') {
    const body = await request.json();
    const err  = validateHandle(body);
    if (err) return json({ error: err }, 400);

    const result = await run(DB,
      `INSERT INTO handles
         (handle_name, platform, brand_name, publisher_id, profile_url, categories,
          followers, geography, property_url, featured, status, custom_image_url)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [body.handle_name.trim(), body.platform, body.brand_name.trim(),
       parseInt(body.publisher_id), body.profile_url || null,
       JSON.stringify(body.categories || []), body.followers || 0,
       body.geography || 'United States', body.property_url || null,
       body.featured ? 1 : 0, 'active', body.custom_image_url || null]);

    return json({ id: result.meta.last_row_id }, 201);
  }

  // PUT /api/handles/:id
  if (request.method === 'PUT' && id) {
    const body    = await request.json();
    const allowed = ['handle_name','platform','brand_name','publisher_id','profile_url',
                     'categories','followers','geography','property_url','featured',
                     'status','removal_reason','removal_notes','custom_image_url'];
    const sets   = [];
    const params = [];

    for (const key of allowed) {
      if (!(key in body)) continue;
      sets.push(`${key} = ?`);
      if (key === 'categories') params.push(JSON.stringify(body[key]));
      else if (key === 'featured') params.push(body[key] ? 1 : 0);
      else params.push(body[key]);
    }

    if (!sets.length) return json({ error: 'Nothing to update' }, 400);
    sets.push(`updated_at = datetime('now')`);
    params.push(id);

    await run(DB, `UPDATE handles SET ${sets.join(', ')} WHERE id = ?`, params);
    return json({ ok: true });
  }

  // DELETE /api/handles/:id
  if (request.method === 'DELETE' && id) {
    await run(DB, `DELETE FROM handles WHERE id = ?`, [id]);
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
