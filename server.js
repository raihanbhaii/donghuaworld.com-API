const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const { graphqlHTTP } = require('express-graphql');
const { buildSchema } = require('graphql');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const BASE_URL = 'https://donghuaworld.com';
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': BASE_URL,
};

// ─────────────────────────────────────────────
//  CORE HELPERS
// ─────────────────────────────────────────────
async function fetchPage(url) {
  try {
    const { data } = await axios.get(url, { headers: HEADERS, timeout: 15000, maxRedirects: 5 });
    return cheerio.load(data);
  } catch (err) {
    throw new Error(err.response ? `HTTP ${err.response.status}: ${url}` : `Network error: ${err.message}`);
  }
}

function imgSrc($el) {
  const img = $el.find('img').first();
  return img.attr('src') || img.attr('data-src') || img.attr('data-lazy-src') || img.attr('data-original') || null;
}

function absUrl(url) {
  if (!url) return null;
  return url.startsWith('http') ? url : `${BASE_URL}${url}`;
}

function slugFrom(url) {
  return url ? url.split('/').filter(Boolean).pop() : null;
}

function extractCards($, container) {
  const results = [];
  const seen = new Set();
  const root = container ? $(container) : $('body');
  const selectors = ['.bsx', '.bs', '.item', 'article.bs', '.animposx', '.excstyle', 'article'];
  for (const sel of selectors) {
    root.find(sel).each((i, el) => {
      const $el = $(el);
      const $a = $el.find('a').first();
      const href = $a.attr('href') || '';
      const title =
        $el.find('.tt, .title, h2, h3').first().text().trim() ||
        $a.attr('title') || $el.find('img').attr('alt') || '';
      if (!href || !title || seen.has(href)) return;
      seen.add(href);
      results.push({
        title: title.trim(),
        slug: slugFrom(href),
        url: absUrl(href),
        thumbnail: imgSrc($el),
        rating: $el.find('.numscore, .score, .imdb').text().trim() || null,
        status: $el.find('.status, .stataus').text().trim() || null,
        latestEpisode: $el.find('.epx, .epcur, .epnum').text().trim() || null,
        type: $el.find('.typez, .type').text().trim() || null,
      });
    });
    if (results.length > 0) break;
  }
  return results;
}

// ─────────────────────────────────────────────
//  SHARED SCRAPER FUNCTIONS (used by REST + GQL)
// ─────────────────────────────────────────────
const scrapers = {
  async latestEpisodes({ page = 1 } = {}) {
    const $ = await fetchPage(page > 1 ? `${BASE_URL}/page/${page}/` : `${BASE_URL}/`);
    const results = [];
    const seen = new Set();
    $('.bs, .item, article').each((i, el) => {
      const $el = $(el);
      const $a = $el.find('a').first();
      const href = $a.attr('href');
      const title = $el.find('.tt, h2, h3').text().trim() || $a.attr('title') || '';
      if (!href || !title || seen.has(href)) return;
      seen.add(href);
      results.push({ title, url: absUrl(href), slug: slugFrom(href), thumbnail: imgSrc($el), episode: $el.find('.epx, .epcur').text().trim() || null, type: $el.find('.typez').text().trim() || null, rating: $el.find('.numscore').text().trim() || null, status: null, latestEpisode: null });
    });
    return results;
  },

  async latest({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?order=update&page=${page}`);
    return extractCards($);
  },

  async popular({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?order=popular&page=${page}`);
    return extractCards($);
  },

  async topRated({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?order=rating&page=${page}`);
    return extractCards($);
  },

  async ongoing({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?status=ongoing&page=${page}`);
    return extractCards($);
  },

  async completed({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?status=complete&page=${page}`);
    return extractCards($);
  },

  async movies({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/anime/?type=movie&page=${page}`);
    return extractCards($);
  },

  async trending() {
    const $ = await fetchPage(`${BASE_URL}/`);
    const results = [];
    const seen = new Set();
    const trendSels = ['.trending', '.trending-list', '[class*="trending"]', '.widget_trending'];
    let found = false;
    for (const sel of trendSels) {
      $(sel).find('.bs, .item, li, article').each((i, el) => {
        const $el = $(el);
        const $a = $el.find('a').first();
        const href = $a.attr('href');
        const title = $el.find('.tt, h2, h3').text().trim() || $a.attr('title') || $a.text().trim() || '';
        if (!href || !title || seen.has(href)) return;
        seen.add(href);
        results.push({ rank: results.length + 1, title, url: absUrl(href), slug: slugFrom(href), thumbnail: imgSrc($el), rating: $el.find('.numscore, .score').text().trim() || null, status: null, latestEpisode: null, type: null });
        found = true;
      });
      if (found) break;
    }
    if (!results.length) {
      const $t = await fetchPage(`${BASE_URL}/anime/?order=popular`);
      extractCards($t).slice(0, 20).forEach((c, i) => results.push({ rank: i + 1, ...c }));
    }
    return results;
  },

  async search({ q }) {
    if (!q) throw new Error("Query 'q' is required");
    const $ = await fetchPage(`${BASE_URL}/?s=${encodeURIComponent(q)}&post_type=anime`);
    return extractCards($);
  },

  async genres() {
    const $ = await fetchPage(`${BASE_URL}/`);
    const genres = [];
    const seen = new Set();
    $('a[href*="/genres/"], a[href*="/genre/"]').each((i, el) => {
      const href = $(el).attr('href');
      const name = $(el).text().trim();
      const slug = slugFrom(href);
      if (href && name && slug && !seen.has(slug)) { seen.add(slug); genres.push({ name, slug, url: absUrl(href) }); }
    });
    return genres;
  },

  async byGenre({ genre, page = 1 }) {
    const $ = await fetchPage(`${BASE_URL}/genres/${genre}/page/${page}/`);
    return extractCards($);
  },

  async byType({ type, page = 1 }) {
    const $ = await fetchPage(`${BASE_URL}/anime/?type=${type}&page=${page}`);
    return extractCards($);
  },

  async byYear({ year, page = 1 }) {
    const $ = await fetchPage(`${BASE_URL}/anime/?year=${year}&page=${page}`);
    return extractCards($);
  },

  async az({ letter = '', page = 1 }) {
    const url = letter
      ? `${BASE_URL}/anime/?letter=${letter}&page=${page}`
      : `${BASE_URL}/anime/?order=title&page=${page}`;
    const $ = await fetchPage(url);
    return extractCards($);
  },

  async filter({ genre, status, type, order, year, season, page = 1 }) {
    const params = new URLSearchParams();
    if (genre)  params.set('genre', genre);
    if (status) params.set('status', status);
    if (type)   params.set('type', type);
    if (order)  params.set('order', order || 'update');
    if (year)   params.set('year', year);
    if (season) params.set('season', season);
    params.set('page', page);
    const $ = await fetchPage(`${BASE_URL}/anime/?${params.toString()}`);
    return extractCards($);
  },

  async series({ slug }) {
    const $ = await fetchPage(`${BASE_URL}/anime/${slug}/`);
    const title = $('h1.entry-title, h1.post-title, h1').first().text().trim() || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const synopsis = $('[itemprop="description"], .entry-content, .synopsis, .desc').first().text().trim().replace(/\s+/g, ' ') || 'No synopsis available.';
    const thumbnail = $('img.wp-post-image').attr('src') || $('meta[property="og:image"]').attr('content') || null;
    const rating = $('[itemprop="ratingValue"], .score, .numscore').text().trim() || 'N/A';
    const views = $('.view, .views').text().trim() || null;
    const genres = [];
    $('a[rel="tag"], .genres a, [itemprop="genre"]').each((i, el) => { const g = $(el).text().trim(); if (g) genres.push(g); });
    const info = {};
    $('.infox .info span, .spe span, .info-content span').each((i, el) => {
      const [key, ...val] = $(el).text().split(':');
      if (key && val.length) info[key.trim()] = val.join(':').trim();
    });
    const episodes = [];
    const epSeen = new Set();
    const epSels = ['a[href*="-episode-"]', '.eplister ul li a', '.eplisterfull ul li a', '.episode-list a', '#episode_by_series a'];
    for (const sel of epSels) {
      $(sel).each((i, el) => {
        const epUrl = $(el).attr('href');
        if (!epUrl || epSeen.has(epUrl)) return;
        epSeen.add(epUrl);
        const epText = $(el).text().trim();
        const numMatch = epText.match(/\d+(\.\d+)?/);
        episodes.push({ number: numMatch ? numMatch[0] : String(i + 1), title: $(el).find('.epl-title').text().trim() || epText || `Episode ${i + 1}`, date: $(el).find('.epl-date').text().trim() || null, url: absUrl(epUrl), slug: slugFrom(epUrl) });
      });
      if (episodes.length) break;
    }
    episodes.sort((a, b) => parseFloat(a.number) - parseFloat(b.number));
    const related = extractCards($, '.related, .relatedposts, [class*="related"]');
    const infoEntries = Object.entries(info).map(([key, value]) => ({ key, value }));
    return { title, slug, url: `${BASE_URL}/anime/${slug}/`, synopsis, thumbnail, rating, views, genres, info: infoEntries, totalEpisodes: episodes.length, episodes, related };
  },

  async episode({ slug }) {
    const urls = [`${BASE_URL}/${slug}/`, `${BASE_URL}/anime/${slug}/`];
    let $, finalUrl;
    for (const url of urls) { try { $ = await fetchPage(url); finalUrl = url; break; } catch {} }
    if (!$) throw new Error(`Episode not found: ${slug}`);
    const title = $('h1, .entry-title').first().text().trim() || slug;
    const servers = [];
    $('iframe[src], iframe[data-src]').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src') || '';
      if (src && !src.includes('disqus') && !src.includes('facebook')) servers.push({ server: `Server ${i + 1}`, embedUrl: src });
    });
    const serverList = [];
    $('select.mirror option, [data-video], .mirror option').each((i, el) => {
      const $el = $(el);
      const label = $el.text().trim();
      const embed = $el.attr('value') || $el.attr('data-video') || '';
      if (label && embed) serverList.push({ label, embedUrl: embed });
    });
    const html = $.html();
    const directVideoLinks = [...new Set([...html.matchAll(/["'](?:file|src|source|url)["']\s*:\s*["']([^"']+\.(?:m3u8|mp4)[^"']*)/g)].map(m => m[1]))];
    const downloads = [];
    $('a[href*=".mp4"], a[href*="download"], a[download]').each((i, el) => {
      const href = $(el).attr('href');
      if (href) downloads.push({ label: $(el).text().trim() || `Download ${i + 1}`, url: href });
    });
    const prev = absUrl($('a.prev, .nav-previous a, a[rel="prev"]').first().attr('href') || null);
    const next = absUrl($('a.next, .nav-next a, a[rel="next"]').first().attr('href') || null);
    const seriesUrl = absUrl($('a[href*="/anime/"]:not([href*="episode"])').first().attr('href') || null);
    return { title, slug, url: finalUrl, seriesUrl, servers: servers.length ? servers : serverList, serverPicker: serverList.length ? serverList : [], directVideoLinks, downloads, navigation: { prev, next } };
  },

  async schedule() {
    let $;
    try { $ = await fetchPage(`${BASE_URL}/schedule/`); } catch { $ = await fetchPage(`${BASE_URL}/`); }
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const result = [];
    days.forEach(day => {
      const items = [];
      $(`.schedule-${day.toLowerCase()}, [data-day="${day}"], [data-day="${day.toLowerCase()}"]`).find('li, .item, .bs').each((i, el) => {
        const $el = $(el);
        const href = $el.find('a').first().attr('href');
        const title = $el.find('.tt, h3, h2').text().trim() || $el.find('a').first().text().trim() || '';
        if (href && title) items.push({ title, url: absUrl(href), slug: slugFrom(href), time: $el.find('.time').text().trim() || null, thumbnail: imgSrc($el) });
      });
      result.push({ day, items });
    });
    return result;
  },

  async home() {
    const $ = await fetchPage(`${BASE_URL}/`);
    const hero = [];
    $('.swiper-slide, .slider-item, .herotop .item, [class*="hero"] .item, .featured-area .item').each((i, el) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href');
      const title = $el.find('.tt, h1, h2, .title').text().trim() || $el.find('a').first().attr('title') || '';
      if (!href || !title) return;
      hero.push({ title, url: absUrl(href), slug: slugFrom(href), thumbnail: imgSrc($el), synopsis: $el.find('.desc, p').first().text().trim() || null, rating: $el.find('.imdb, .score, .numscore').text().trim() || null, episode: $el.find('.epcur, .epx').text().trim() || null, status: $el.find('.status').text().trim() || null, genres: $el.find('.genres a').map((i, a) => $(a).text().trim()).get() });
    });
    const [latest, trending, popular, ongoing] = await Promise.allSettled([
      scrapers.latestEpisodes({ page: 1 }),
      scrapers.trending(),
      scrapers.popular({ page: 1 }),
      scrapers.ongoing({ page: 1 }),
    ]);
    const genres = await scrapers.genres();
    return {
      hero,
      latestEpisodes: latest.status === 'fulfilled' ? latest.value : [],
      trending: trending.status === 'fulfilled' ? trending.value : [],
      popular: popular.status === 'fulfilled' ? popular.value : [],
      ongoing: ongoing.status === 'fulfilled' ? ongoing.value : [],
      genres,
    };
  },

  async random() {
    const $ = await fetchPage(`${BASE_URL}/anime/?order=random`);
    const results = extractCards($);
    return results[Math.floor(Math.random() * results.length)] || null;
  },

  async news({ page = 1 } = {}) {
    const $ = await fetchPage(`${BASE_URL}/news/page/${page}/`);
    const posts = [];
    $('article, .post, .entry').each((i, el) => {
      const $el = $(el);
      const href = $el.find('a').first().attr('href');
      const title = $el.find('h1, h2, h3, .entry-title').text().trim();
      if (href && title) posts.push({ title, url: absUrl(href), date: $el.find('.date, time').text().trim() || null, excerpt: $el.find('.excerpt, .entry-summary, p').first().text().trim() || null, thumbnail: imgSrc($el) });
    });
    return posts;
  },
};

// ─────────────────────────────────────────────
//  GRAPHQL SCHEMA
// ─────────────────────────────────────────────
const schema = buildSchema(`
  type Card {
    title: String!
    slug: String
    url: String
    thumbnail: String
    rating: String
    status: String
    latestEpisode: String
    type: String
  }

  type TrendingCard {
    rank: Int
    title: String!
    slug: String
    url: String
    thumbnail: String
    rating: String
    status: String
    latestEpisode: String
    type: String
  }

  type Episode {
    number: String
    title: String
    date: String
    url: String
    slug: String
  }

  type InfoEntry {
    key: String
    value: String
  }

  type Series {
    title: String!
    slug: String!
    url: String
    synopsis: String
    thumbnail: String
    rating: String
    views: String
    genres: [String]
    info: [InfoEntry]
    totalEpisodes: Int
    episodes: [Episode]
    related: [Card]
  }

  type VideoServer {
    server: String
    embedUrl: String
  }

  type PickerServer {
    label: String
    embedUrl: String
  }

  type Download {
    label: String
    url: String
  }

  type Navigation {
    prev: String
    next: String
  }

  type EpisodePage {
    title: String
    slug: String
    url: String
    seriesUrl: String
    servers: [VideoServer]
    serverPicker: [PickerServer]
    directVideoLinks: [String]
    downloads: [Download]
    navigation: Navigation
  }

  type Genre {
    name: String!
    slug: String
    url: String
  }

  type ScheduleItem {
    title: String
    url: String
    slug: String
    time: String
    thumbnail: String
  }

  type DaySchedule {
    day: String!
    items: [ScheduleItem]
  }

  type HeroItem {
    title: String!
    url: String
    slug: String
    thumbnail: String
    synopsis: String
    rating: String
    episode: String
    status: String
    genres: [String]
  }

  type HomePage {
    hero: [HeroItem]
    latestEpisodes: [Card]
    trending: [TrendingCard]
    popular: [Card]
    ongoing: [Card]
    genres: [Genre]
  }

  type NewsPost {
    title: String
    url: String
    date: String
    excerpt: String
    thumbnail: String
  }

  type PagedCards {
    page: Int
    count: Int
    results: [Card]
  }

  type Query {
    # Full homepage in one call
    home: HomePage

    # Hero banners
    hero: [HeroItem]

    # Listings
    latestEpisodes(page: Int): PagedCards
    latest(page: Int): PagedCards
    popular(page: Int): PagedCards
    trending: [TrendingCard]
    ongoing(page: Int): PagedCards
    completed(page: Int): PagedCards
    topRated(page: Int): PagedCards
    movies(page: Int): PagedCards

    # Browse
    az(letter: String, page: Int): PagedCards
    genres: [Genre]
    byGenre(genre: String!, page: Int): PagedCards
    byType(type: String!, page: Int): PagedCards
    byYear(year: String!, page: Int): PagedCards

    # Filter (multi-param)
    filter(
      genre: String
      status: String
      type: String
      order: String
      year: String
      season: String
      page: Int
    ): PagedCards

    # Content
    series(slug: String!): Series
    episode(slug: String!): EpisodePage

    # Misc
    schedule: [DaySchedule]
    search(q: String!): PagedCards
    random: Card
    news(page: Int): [NewsPost]
  }
`);

// ─────────────────────────────────────────────
//  GRAPHQL RESOLVERS
// ─────────────────────────────────────────────
const root = {
  home: () => scrapers.home(),
  hero: async () => { const h = await scrapers.home(); return h.hero; },

  latestEpisodes: async ({ page = 1 }) => { const r = await scrapers.latestEpisodes({ page }); return { page, count: r.length, results: r }; },
  latest: async ({ page = 1 }) => { const r = await scrapers.latest({ page }); return { page, count: r.length, results: r }; },
  popular: async ({ page = 1 }) => { const r = await scrapers.popular({ page }); return { page, count: r.length, results: r }; },
  trending: () => scrapers.trending(),
  ongoing: async ({ page = 1 }) => { const r = await scrapers.ongoing({ page }); return { page, count: r.length, results: r }; },
  completed: async ({ page = 1 }) => { const r = await scrapers.completed({ page }); return { page, count: r.length, results: r }; },
  topRated: async ({ page = 1 }) => { const r = await scrapers.topRated({ page }); return { page, count: r.length, results: r }; },
  movies: async ({ page = 1 }) => { const r = await scrapers.movies({ page }); return { page, count: r.length, results: r }; },

  az: async ({ letter = '', page = 1 }) => { const r = await scrapers.az({ letter, page }); return { page, count: r.length, results: r }; },
  genres: () => scrapers.genres(),
  byGenre: async ({ genre, page = 1 }) => { const r = await scrapers.byGenre({ genre, page }); return { page, count: r.length, results: r }; },
  byType: async ({ type, page = 1 }) => { const r = await scrapers.byType({ type, page }); return { page, count: r.length, results: r }; },
  byYear: async ({ year, page = 1 }) => { const r = await scrapers.byYear({ year, page }); return { page, count: r.length, results: r }; },

  filter: async (args) => { const r = await scrapers.filter(args); return { page: args.page || 1, count: r.length, results: r }; },

  series: ({ slug }) => scrapers.series({ slug }),
  episode: ({ slug }) => scrapers.episode({ slug }),

  schedule: () => scrapers.schedule(),
  search: async ({ q }) => { const r = await scrapers.search({ q }); return { page: 1, count: r.length, results: r }; },
  random: () => scrapers.random(),
  news: async ({ page = 1 }) => scrapers.news({ page }),
};

// ─────────────────────────────────────────────
//  GRAPHQL ENDPOINT
// ─────────────────────────────────────────────
app.use('/graphql', graphqlHTTP({
  schema,
  rootValue: root,
  graphiql: true,   // Interactive browser IDE at /graphql
  customFormatErrorFn: (err) => ({ message: err.message, locations: err.locations, path: err.path }),
}));

// ─────────────────────────────────────────────
//  REST ENDPOINTS (unchanged, calls same scrapers)
// ─────────────────────────────────────────────
const wrap = (fn) => async (req, res) => { try { res.json(await fn(req)); } catch (err) { res.status(500).json({ error: err.message }); } };

app.get('/home',            wrap(async () => scrapers.home()));
app.get('/hero',            wrap(async () => scrapers.home().then(d => ({ count: d.hero.length, hero: d.hero }))));
app.get('/latest-episodes', wrap(async (req) => { const r = await scrapers.latestEpisodes({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/latest',          wrap(async (req) => { const r = await scrapers.latest({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/popular',         wrap(async (req) => { const r = await scrapers.popular({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/trending',        wrap(async () => { const r = await scrapers.trending(); return { count: r.length, results: r }; }));
app.get('/ongoing',         wrap(async (req) => { const r = await scrapers.ongoing({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/completed',       wrap(async (req) => { const r = await scrapers.completed({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/top-rated',       wrap(async (req) => { const r = await scrapers.topRated({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/movies',          wrap(async (req) => { const r = await scrapers.movies({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/az',              wrap(async (req) => { const r = await scrapers.az({ letter: req.query.letter, page: req.query.page }); return { page: Number(req.query.page || 1), letter: (req.query.letter || 'ALL').toUpperCase(), count: r.length, results: r }; }));
app.get('/genres',          wrap(async () => { const g = await scrapers.genres(); return { count: g.length, genres: g }; }));
app.get('/genre/:genre',    wrap(async (req) => { const r = await scrapers.byGenre({ genre: req.params.genre, page: req.query.page }); return { genre: req.params.genre, page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/type/:type',      wrap(async (req) => { const r = await scrapers.byType({ type: req.params.type, page: req.query.page }); return { type: req.params.type, page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/year/:year',      wrap(async (req) => { const r = await scrapers.byYear({ year: req.params.year, page: req.query.page }); return { year: req.params.year, page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/filter',          wrap(async (req) => { const r = await scrapers.filter(req.query); return { filters: req.query, page: Number(req.query.page || 1), count: r.length, results: r }; }));
app.get('/schedule',        wrap(async () => { const s = await scrapers.schedule(); return { schedule: s }; }));
app.get('/search',          wrap(async (req) => { if (!req.query.q) throw Object.assign(new Error("'q' is required"), { status: 400 }); const r = await scrapers.search({ q: req.query.q }); return { query: req.query.q, count: r.length, results: r }; }));
app.get('/random',          wrap(async () => scrapers.random()));
app.get('/news',            wrap(async (req) => { const r = await scrapers.news({ page: req.query.page }); return { page: Number(req.query.page || 1), count: r.length, posts: r }; }));
app.get('/series/:slug',    wrap(async (req) => scrapers.series({ slug: req.params.slug })));
app.get('/episode/:slug',   wrap(async (req) => scrapers.episode({ slug: req.params.slug })));

// ─────────────────────────────────────────────
//  ROOT DOCS
// ─────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'DonghuaWorld API',
    version: '4.0.0',
    status: '✅ Running',
    graphql: {
      endpoint: '/graphql',
      playground: '/graphql  (open in browser for interactive IDE)',
      example_query: `
{ 
  home { 
    hero { title slug thumbnail rating }
    trending { rank title slug thumbnail }
    latestEpisodes { results { title slug episode thumbnail } }
  }
}`.trim()
    },
    rest: {
      'GET /home':              'All homepage sections',
      'GET /hero':              'Hero banners',
      'GET /latest-episodes':   '?page=N',
      'GET /latest':            '?page=N',
      'GET /popular':           '?page=N',
      'GET /trending':          '',
      'GET /ongoing':           '?page=N',
      'GET /completed':         '?page=N',
      'GET /top-rated':         '?page=N',
      'GET /movies':            '?page=N',
      'GET /az':                '?letter=A&page=N',
      'GET /genres':            'All genres',
      'GET /genre/:genre':      '?page=N',
      'GET /type/:type':        '?page=N',
      'GET /year/:year':        '?page=N',
      'GET /filter':            '?genre=&status=&type=&order=&year=',
      'GET /series/:slug':      'Series detail + episodes',
      'GET /episode/:slug':     'Episode + video servers',
      'GET /schedule':          'Weekly schedule',
      'GET /search':            '?q=title',
      'GET /random':            '',
      'GET /news':              '?page=N',
    }
  });
});

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));
app.use((err, req, res, next) => { console.error(err); res.status(err.status || 500).json({ error: err.message }); });

app.listen(PORT, () => console.log(`🚀 DonghuaWorld API v4 → http://localhost:${PORT}\n📊 GraphQL IDE  → http://localhost:${PORT}/graphql`));
