import { queryOne } from '../lib/db.js';
import { json } from '../lib/cors.js';

export async function handleStats(request, env) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  const { DB } = env;

  const row = await queryOne(DB, `
    SELECT
      COUNT(*)                                                     AS total_handles,
      SUM(CASE WHEN status = 'active'  THEN 1 ELSE 0 END)         AS active_handles,
      SUM(CASE WHEN status = 'paused'  THEN 1 ELSE 0 END)         AS paused_handles,
      SUM(CASE WHEN status = 'removed' THEN 1 ELSE 0 END)         AS removed_handles,
      SUM(CASE WHEN featured = 1 AND status = 'active' THEN 1 ELSE 0 END) AS featured_count,
      SUM(CASE WHEN platform = 'fb' AND status = 'active' THEN 1 ELSE 0 END) AS fb_count,
      SUM(CASE WHEN platform = 'ig' AND status = 'active' THEN 1 ELSE 0 END) AS ig_count,
      SUM(CASE WHEN status = 'active' THEN followers ELSE 0 END)  AS total_reach
    FROM handles
  `);

  const pubRow = await queryOne(DB, `SELECT COUNT(*) AS n FROM publishers WHERE status = 'active'`);

  return json({
    total_handles:   row.total_handles,
    active_handles:  row.active_handles,
    paused_handles:  row.paused_handles,
    removed_handles: row.removed_handles,
    featured_count:  row.featured_count,
    fb_count:        row.fb_count,
    ig_count:        row.ig_count,
    total_reach:     row.total_reach,
    publisher_count: pubRow.n,
  });
}
