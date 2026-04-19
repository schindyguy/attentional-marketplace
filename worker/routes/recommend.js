import { queryMany } from '../lib/db.js';
import { json } from '../lib/cors.js';

const DOMAIN_CATS = {
  'petco.com':       ['Pets','Animals','CPG','Home'],
  'petsmart.com':    ['Pets','Animals','CPG'],
  'chewy.com':       ['Pets','Animals','CPG'],
  'buzzfeed.com':    ['Food','Entertainment','Viral','Lifestyle'],
  'nytimes.com':     ['News','Politics','Culture'],
  'cnn.com':         ['News','Politics'],
  'hm.com':          ['Fashion','Lifestyle'],
  'zara.com':        ['Fashion','Lifestyle'],
  'sephora.com':     ['Beauty','Fashion','Lifestyle'],
  'ulta.com':        ['Beauty','Fashion'],
  'wholefoodsmarket.com': ['Food','Health','CPG'],
  'target.com':      ['Lifestyle','Home','CPG'],
  'amazon.com':      ['Lifestyle','Home','CPG','Entertainment'],
  'ikea.com':        ['Home','Lifestyle'],
  'nike.com':        ['Sports','Lifestyle','Fitness'],
  'adidas.com':      ['Sports','Lifestyle','Fitness'],
  'netflix.com':     ['Entertainment','Viral'],
  'hulu.com':        ['Entertainment'],
  'adweek.com':      ['Marketing','Advertising','Business'],
  'bustle.com':      ['Lifestyle','Fashion','Entertainment'],
};

const KEYWORD_CATS = {
  pet:     ['Pets','Animals'],
  dog:     ['Pets','Animals'],
  cat:     ['Pets','Animals'],
  food:    ['Food','Recipes'],
  cook:    ['Food','Recipes','Cooking'],
  recipe:  ['Food','Recipes','Cooking'],
  news:    ['News'],
  health:  ['Health','Wellness'],
  fit:     ['Health','Fitness'],
  fashion: ['Fashion','Beauty'],
  beauty:  ['Beauty','Fashion'],
  home:    ['Home','Lifestyle'],
  comedy:  ['Comedy','Entertainment'],
  sport:   ['Sports','Fitness'],
  travel:  ['Travel','Lifestyle'],
  tech:    ['Technology','Business'],
  market:  ['Marketing','Business','Advertising'],
};

function domainToCategories(domain) {
  const d = domain.toLowerCase().replace(/^www\./, '');
  if (DOMAIN_CATS[d]) return DOMAIN_CATS[d];
  const stem    = d.replace(/\.(com|net|org|co|io|us|uk).*/, '');
  const tokens  = stem.split(/[-_.]/);
  const cats    = new Set();
  for (const token of tokens) {
    for (const [kw, vals] of Object.entries(KEYWORD_CATS)) {
      if (token.includes(kw)) vals.forEach(c => cats.add(c));
    }
  }
  return cats.size > 0 ? [...cats] : ['Lifestyle', 'Entertainment'];
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

function buildReason(matchedTags, totalReach, brandName) {
  const tagStr = matchedTags.slice(0, 3).join(' and ');
  return `${brandName}'s ${tagStr} content reaches ${formatReach(totalReach)} — endemic to your brand's audience.`;
}

export async function handleRecommend(request, env) {
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const body   = await request.json();
  const domain = (body.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*/, '');
  if (!domain) return json({ error: 'domain is required' }, 400);

  const inputCats = domainToCategories(domain);
  const { DB }    = env;

  const rows = await queryMany(DB,
    `SELECT h.*, p.name AS publisher_name
     FROM handles h LEFT JOIN publishers p ON p.id = h.publisher_id
     WHERE h.status = 'active'
     ORDER BY h.followers DESC`);

  // Group by brand
  const brands = new Map();
  for (const row of rows) {
    const key  = brandKey(row.brand_name);
    const cats = JSON.parse(row.categories || '[]');
    if (!brands.has(key)) {
      brands.set(key, { key, name: row.brand_name, publisher: row.publisher_name,
                        categories: [], total_reach: 0 });
    }
    const b = brands.get(key);
    b.total_reach += row.followers;
    for (const c of cats) { if (!b.categories.includes(c)) b.categories.push(c); }
  }

  // Score each brand
  const results = [];
  for (const b of brands.values()) {
    const matched = inputCats.filter(c => b.categories.includes(c));
    if (!matched.length) continue;

    const overlap  = matched.length / Math.max(inputCats.length, b.categories.length);
    const base     = overlap * 100;
    const reachBonus = Math.min(20, Math.log10(b.total_reach + 1) * 2);
    const score    = Math.min(100, Math.round(base + reachBonus));

    if (score < 30) continue;

    results.push({
      brand_key:    b.key,
      brand_name:   b.name,
      publisher_name: b.publisher,
      score,
      match_label:  `${score}% match`,
      reason:       buildReason(matched, b.total_reach, b.name),
      matched_tags: matched,
      total_reach:  b.total_reach,
      categories:   b.categories,
    });
  }

  results.sort((a, b) => b.score - a.score);

  return json({
    query_domain:       domain,
    matched_categories: inputCats,
    results:            results.slice(0, 10),
  });
}
