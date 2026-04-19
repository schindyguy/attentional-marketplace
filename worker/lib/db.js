export async function queryMany(DB, sql, params = []) {
  const result = await DB.prepare(sql).bind(...params).all();
  return result.results;
}

export async function queryOne(DB, sql, params = []) {
  return DB.prepare(sql).bind(...params).first();
}

export async function run(DB, sql, params = []) {
  return DB.prepare(sql).bind(...params).run();
}
