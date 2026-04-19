import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';

const CACHE_TTL = 30 * 24 * 60 * 60; // 30 days in seconds
const IG_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="65%" height="65%"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1.1" fill="currentColor" stroke="none"/></svg>`;

export function normalizeDomain(raw) {
  return (raw || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/[/?#].*$/, '');
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
      signal: AbortSignal.timeout(8000),
      redirect: 'follow',
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
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

async function analyzeDomain(domain, apiKey) {
  // Try https first, fall back to www
  let homeHtml = await fetchPage(`https://${domain}`);
  if (!homeHtml) homeHtml = await fetchPage(`https://www.${domain}`);
  if (!homeHtml) throw new Error(`Could not fetch ${domain}`);

  const homeText = stripHtml(homeHtml);
  const links = findRelevantLinks(homeHtml, domain);

  const extraResults = await Promise.allSettled(links.map(url => fetchPage(url).then(stripHtml)));
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

  return JSON.parse(jsonMatch[0]);
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

function shuffleIntoResults(scored, pinnedKeys, resultCount) {
  const pinnedSet = new Set(pinnedKeys);
  const pinned = [];
  const organic = [];

  for (const r of scored) {
    if (pinnedSet.has(r.brand_key)) pinned.push(r);
    else organic.push(r);
  }

  // Fill organic up to (resultCount - pinned.length), then merge
  const organicSlice = organic.slice(0, Math.max(0, resultCount - pinned.length));
  const combined = [...organicSlice, ...pinned];

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

  const { DB } = env;

  // Load admin settings
  const settingRows = await queryMany(DB, `SELECT key, value FROM admin_discover_settings`);
  const settings = Object.fromEntries(settingRows.map(r => [r.key, r.value]));
  const resultCount = parseInt(settings.result_count || '10', 10);
  const pinnedKeys = JSON.parse(settings.pinned_brand_keys || '[]');

  // Check D1 cache
  const cached = await DB.prepare(
    `SELECT dna_json, analyzed_at FROM advertiser_domains WHERE domain = ?`
  ).bind(domain).first();

  const now = Math.floor(Date.now() / 1000);
  let dna;

  if (cached && (now - cached.analyzed_at) < CACHE_TTL) {
    dna = JSON.parse(cached.dna_json);
  } else {
    try {
      dna = await analyzeDomain(domain, env.ANTHROPIC_API_KEY);
    } catch (e) {
      return json({ error: 'Analysis failed: ' + e.message }, 500);
    }
    await DB.prepare(
      `INSERT INTO advertiser_domains (domain, dna_json, analyzed_at) VALUES (?, ?, ?)
       ON CONFLICT(domain) DO UPDATE SET dna_json = excluded.dna_json, analyzed_at = excluded.analyzed_at`
    ).bind(domain, JSON.stringify(dna), now).run();
  }

  // Load all active brands
  const rows = await queryMany(DB,
    `SELECT h.*, p.name AS publisher_name
     FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
     WHERE h.status = 'active'
     ORDER BY h.followers DESC`);

  const brands = new Map();
  for (const row of rows) {
    const key = brandKey(row.brand_name);
    const cats = JSON.parse(row.categories || '[]');
    if (!brands.has(key)) {
      brands.set(key, { key, name: row.brand_name, publisher: row.publisher_name, categories: [], total_reach: 0 });
    }
    const b = brands.get(key);
    b.total_reach += row.followers;
    for (const c of cats) { if (!b.categories.includes(c)) b.categories.push(c); }
  }

  let scored = scoreBrands(brands, dna);

  // Ensure pinned brands are always included even if below score threshold
  for (const pk of pinnedKeys) {
    if (!scored.find(r => r.brand_key === pk) && brands.has(pk)) {
      const b = brands.get(pk);
      scored.push({
        brand_key: b.key, brand_name: b.name, publisher_name: b.publisher,
        score: 0, match_label: 'Featured',
        reason: `Recommended publisher for your campaign.`,
        matched_tags: b.categories.slice(0, 3),
        total_reach: b.total_reach, categories: b.categories,
      });
    }
  }

  const results = shuffleIntoResults(scored, pinnedKeys, resultCount);

  return json({ domain, dna, results });
}
