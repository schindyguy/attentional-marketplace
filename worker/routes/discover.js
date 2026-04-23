import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';
import { evaluateRules, applyVerdicts } from '../lib/rules.js';

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
// Bump when the DNA JSON shape changes. Cached rows with a lower
// schema_version are treated as stale and re-analyzed on next read.
const DNA_SCHEMA_VERSION = 2;

const GENDER_VALUES = ['male', 'female', 'mixed'];
const AGE_SKEW_VALUES = ['young', 'adult', 'senior', 'mixed'];

function normalizeEnum(value, allowed, fallback) {
  if (typeof value !== 'string') return fallback;
  const v = value.trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}
const IG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="65%" height="65%"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;

export function normalizeDomain(raw) {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[/?#].*$/, '');
}

const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchDirect(url, diag) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
      redirect: 'follow',
    });
    if (!res.ok) {
      if (diag) diag.push(`direct ${url} → HTTP ${res.status}`);
      return { html: '', status: res.status };
    }
    return { html: await res.text(), status: res.status };
  } catch (e) {
    if (diag) diag.push(`direct ${url} → ${e.name}: ${e.message}`);
    return { html: '', status: 0 };
  }
}

async function fetchViaScraperApi(url, scraperKey, diag) {
  const proxied = `https://api.scraperapi.com/?api_key=${encodeURIComponent(scraperKey)}&url=${encodeURIComponent(url)}`;
  try {
    const res = await fetch(proxied, {
      signal: AbortSignal.timeout(60000),
      redirect: 'follow',
    });
    if (!res.ok) {
      if (diag) diag.push(`scraperapi ${url} → HTTP ${res.status}`);
      return '';
    }
    return await res.text();
  } catch (e) {
    if (diag) diag.push(`scraperapi ${url} → ${e.name}: ${e.message}`);
    return '';
  }
}

// Direct first to save credits; on bot-block status (401/403/429/503) or
// network failure, retry through ScraperAPI if a key is configured.
async function fetchPage(url, diag, scraperKey) {
  const direct = await fetchDirect(url, diag);
  if (direct.html) return direct.html;
  if (!scraperKey) return '';
  const blocked = direct.status === 0 || [401, 403, 429, 451, 502, 503].includes(direct.status);
  if (!blocked) return '';
  return await fetchViaScraperApi(url, scraperKey, diag);
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 3000);
}

function findRelevantLinks(html, domain) {
  const patterns = [/\/about/i, /\/product/i, /\/service/i, /\/shop/i, /\/brand/i, /\/what-we/i, /\/our-/i];
  const hrefRe = /href=["']([^"'#\s]+)["']/gi;
  const seen = new Set();
  const links = [];
  let m;
  while ((m = hrefRe.exec(html)) !== null) {
    const href = m[1];
    if (href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    const fullUrl = href.startsWith('http')
      ? href
      : `https://${domain}${href.startsWith('/') ? '' : '/'}${href}`;
    if (!fullUrl.includes(domain)) continue;
    if (seen.has(fullUrl)) continue;
    seen.add(fullUrl);
    if (patterns.some(p => p.test(fullUrl))) links.push(fullUrl);
    if (links.length >= 4) break;
  }
  return links;
}

async function analyzeDomain(domain, apiKey, scraperKey) {
  const diag = [];
  let homeHtml = await fetchPage(`https://${domain}`, diag, scraperKey);
  if (!homeHtml) homeHtml = await fetchPage(`https://www.${domain}`, diag, scraperKey);
  if (!homeHtml) {
    const blob = diag.join(' | ');
    if (/HTTP 40[13]/.test(blob)) {
      throw new Error(`${domain} blocks automated analysis (likely behind a bot-protection layer). Try a different domain.`);
    }
    if (/Timeout/i.test(blob)) {
      throw new Error(`${domain} took too long to respond. Try again or use a different domain.`);
    }
    throw new Error(`Could not reach ${domain}. Please double-check the URL.`);
  }

  const homeText = stripHtml(homeHtml);
  const links = findRelevantLinks(homeHtml, domain);

  const extraResults = await Promise.allSettled(links.map(url => fetchPage(url, diag, scraperKey).then(stripHtml)));
  const extraText = extraResults
    .filter(r => r.status === 'fulfilled' && r.value)
    .map(r => r.value)
    .join('\n\n---\n\n');

  const siteContent = [homeText, extraText].filter(Boolean).join('\n\n---\n\n').slice(0, 12000);

  const prompt = `You are analyzing a brand's website to build their advertising DNA profile. Return ONLY valid JSON — no markdown, no explanation.

Website: ${domain}
Content:
---
${siteContent}
---

Return exactly this JSON structure:
{
  "summary": "1-2 sentence executive summary of what this business does and who it targets",
  "bullets": [
    "Category: [primary business category]",
    "Sells: [Product / Service / Both]",
    "Audience: [B2C / B2B / Both]",
    "Demographics: [age range, gender if apparent, lifestyle signals]",
    "Tone: [e.g. premium, mass-market, budget, professional, playful, inspirational]",
    "Geography: [Local / National / Global]"
  ],
  "categories": ["2 to 4 relevant categories from this list only: Food, Pets, Animals, Lifestyle, Fashion, Beauty, Health, Fitness, Sports, Entertainment, Comedy, Viral, News, Politics, Travel, Technology, Business, Marketing, Home, CPG, Cooking, Recipes, Wellness"],
  "sell_type": "product|service|both",
  "audience_type": "B2C|B2B|both",
  "audience_gender": "male|female|mixed — use 'mixed' when the brand targets a general audience with no clear gender skew",
  "age_skew": "young|adult|senior|mixed — young=under 30, adult=30-55, senior=55+, mixed=no clear age skew",
  "tone": "premium|mass-market|budget|professional|playful|inspirational",
  "keywords": ["5 to 8 descriptive keywords about the brand"]
}`;

  const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!apiRes.ok) {
    const errText = await apiRes.text();
    throw new Error(`Claude API ${apiRes.status}: ${errText.slice(0, 200)}`);
  }

  const apiJson = await apiRes.json();
  const rawText = apiJson.content?.[0]?.text || '';
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Could not parse Claude response');

  const parsed = JSON.parse(jsonMatch[0]);
  parsed.audience_gender = normalizeEnum(parsed.audience_gender, GENDER_VALUES, 'mixed');
  parsed.age_skew = normalizeEnum(parsed.age_skew, AGE_SKEW_VALUES, 'mixed');
  return parsed;
}

function brandKey(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function formatReach(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function scoreBrands(brands, dna) {
  const inputCats = dna.categories || [];
  const results = [];

  for (const b of brands.values()) {
    const matched = inputCats.filter(c => b.categories.includes(c));
    if (!matched.length) continue;

    const overlap = matched.length / Math.max(inputCats.length, b.categories.length);
    const base = overlap * 100;
    const reachBonus = Math.min(20, Math.log10(b.total_reach + 1) * 2);
    const score = Math.min(100, Math.round(base + reachBonus));
    if (score < 25) continue;

    results.push({
      brand_key: b.key,
      brand_name: b.name,
      publisher_name: b.publisher,
      score,
      match_label: `${score}% match`,
      reason: `${b.name}'s ${matched.slice(0, 2).join(' and ')} content reaches ${formatReach(b.total_reach)} — endemic to your brand's audience.`,
      matched_tags: matched,
      total_reach: b.total_reach,
      categories: b.categories,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results;
}

function shuffleIntoResults(scored, guaranteedKeys, resultCount) {
  const guaranteedSet = guaranteedKeys instanceof Set ? guaranteedKeys : new Set(guaranteedKeys);
  const guaranteed = [];
  const organic = [];

  for (const r of scored) {
    if (guaranteedSet.has(r.brand_key)) guaranteed.push(r);
    else organic.push(r);
  }

  const organicSlice = organic.slice(0, Math.max(0, resultCount - guaranteed.length));
  const combined = [...organicSlice, ...guaranteed];

  // Fisher-Yates shuffle
  for (let i = combined.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [combined[i], combined[j]] = [combined[j], combined[i]];
  }

  return combined.slice(0, resultCount).map((r, i) => ({ ...r, rank: i + 1 }));
}

export async function handleDiscover(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body = await request.json();
  const raw = (body.domain || '').trim();
  if (!raw) return json({ error: 'domain is required' }, 400);

  const domain = normalizeDomain(raw);
  if (!domain || domain.length < 3 || !domain.includes('.')) {
    return json({ error: 'Invalid domain' }, 400);
  }

  if (!env.ANTHROPIC_API_KEY) return json({ error: 'ANTHROPIC_API_KEY not configured' }, 500);

  let out;
  try {
    out = await runRecommendationPipeline(env, domain);
  } catch (e) {
    return json({ error: 'Analysis failed: ' + e.message }, 500);
  }

  // Public response: advertisers see the final list only. Admin uses
  // /api/admin/rules/test to get the full pipeline trace.
  const publicResults = out.results.map(r => {
    const { triggered_rules: _tr, ...rest } = r;
    return rest;
  });
  return json({ domain: out.domain, dna: out.dna, results: publicResults });
}

// Shared recommendation pipeline — used by the admin test endpoint so the trace
// and the public endpoint cannot diverge. Returns the full, untrimmed picture.
export async function runRecommendationPipeline(env, domain, { skipLog = false } = {}) {
  const { DB } = env;

  const settingRows = await queryMany(DB, `SELECT key, value FROM admin_discover_settings`);
  const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
  const resultCount = parseInt(settings.result_count || '10', 10);

  const cached = await DB.prepare(
    `SELECT dna_json, analyzed_at, schema_version FROM advertiser_domains WHERE domain = ?`
  ).bind(domain).first();
  const now = Math.floor(Date.now() / 1000);
  const cacheValid = cached
    && (now - cached.analyzed_at) < CACHE_TTL
    && (cached.schema_version ?? 1) >= DNA_SCHEMA_VERSION;

  let dna;
  if (cacheValid) {
    dna = JSON.parse(cached.dna_json);
  } else {
    dna = await analyzeDomain(domain, env.ANTHROPIC_API_KEY, env.SCRAPERAPI_KEY);
    await DB.prepare(
      `INSERT INTO advertiser_domains (domain, dna_json, analyzed_at, schema_version) VALUES (?, ?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET
         dna_json = excluded.dna_json,
         analyzed_at = excluded.analyzed_at,
         schema_version = excluded.schema_version`
    ).bind(domain, JSON.stringify(dna), now, DNA_SCHEMA_VERSION).run();
  }

  const handleRows = await queryMany(DB,
    `SELECT h.*, p.name AS publisher_name
     FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
     WHERE h.status = 'active'
     ORDER BY h.followers DESC`);

  const brands = new Map();
  for (const row of handleRows) {
    const key = brandKey(row.brand_name);
    const cats = JSON.parse(row.categories || '[]');
    if (!brands.has(key)) brands.set(key, { key, name: row.brand_name, publisher: row.publisher_name, categories: [], total_reach: 0 });
    const b = brands.get(key);
    b.total_reach += row.followers;
    for (const c of cats) { if (!b.categories.includes(c)) b.categories.push(c); }
  }

  let scored = scoreBrands(brands, dna);

  const ruleRows = await queryMany(DB,
    `SELECT id, name, priority, enabled, conditions_json, action, brand_keys_json, boost_points, deleted_at
     FROM recommendation_rules WHERE deleted_at IS NULL`);
  const { fired, skipped, verdicts } = evaluateRules(ruleRows, dna);
  const { excluded, forceIncluded, unknownRefs } = applyVerdicts(scored, brands, verdicts);

  scored.sort((a, b) => b.score - a.score);

  const results = shuffleIntoResults(scored, forceIncluded, resultCount);

  if (!skipLog && fired.length) {
    const firedIds = fired.map(f => f.rule_id);
    const placeholders = firedIds.map(() => '?').join(',');
    try {
      await DB.prepare(
        `UPDATE recommendation_rules
         SET fire_count = fire_count + 1, last_fired_at = unixepoch()
         WHERE id IN (${placeholders})`
      ).bind(...firedIds).run();
    } catch (_) {}
  }
  if (!skipLog) {
    try {
      await DB.prepare(
        `INSERT INTO recommendation_log (domain, dna_json, triggered_rules, excluded_brands, result_keys)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(
        domain,
        JSON.stringify(dna),
        JSON.stringify(fired),
        JSON.stringify(excluded),
        JSON.stringify(results.map(r => r.brand_key)),
      ).run();
    } catch (_) {}
  }

  return {
    domain, dna, results,
    debug: { fired_rules: fired, skipped_rules: skipped, excluded, unknown_brand_refs: unknownRefs },
  };
}
