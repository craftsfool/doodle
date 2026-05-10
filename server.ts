import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // Doodle Cache Strategy
  let doodleCache: any[] | null = null;
  let lastFetchTime: number = 0;
  const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour
  const HISTORY_LIMIT = 12;
  const imageCache = new Map<string, { body: Buffer; contentType: string; fetchedAt: number }>();
  const translationCache = new Map<string, string>();
  const timeZoneCache = new Map<string, { timeZone: string | null; fetchedAt: number }>();

  function decodeHtml(value = '') {
    return value
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&rsquo;/g, '’')
      .replace(/&lsquo;/g, '‘')
      .replace(/&ldquo;/g, '“')
      .replace(/&rdquo;/g, '”');
  }

  function hasChinese(value = '') {
    return /[\u3400-\u9fff]/.test(value);
  }

  function clientIp(req: express.Request) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const raw = forwarded || String(req.headers['cf-connecting-ip'] || '') || req.socket.remoteAddress || '';
    const ip = raw.replace(/^::ffff:/, '');
    if (!ip || ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.')) {
      return null;
    }
    return ip;
  }

  async function fetchTimeZoneForIp(ip: string | null) {
    if (!ip) return null;

    const cached = timeZoneCache.get(ip);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.timeZone;
    }

    try {
      const response = await requestText(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, 10000);
      const payload = JSON.parse(response);
      const timeZone = typeof payload?.timezone === 'string' ? payload.timezone : null;
      timeZoneCache.set(ip, { timeZone, fetchedAt: Date.now() });
      return timeZone;
    } catch {
      timeZoneCache.set(ip, { timeZone: null, fetchedAt: Date.now() });
      return null;
    }
  }

  async function translateToSimplifiedChinese(value = '') {
    const text = value.trim();
    if (!text || hasChinese(text)) return text;
    if (translationCache.has(text)) return translationCache.get(text) || text;

    try {
      const url = new URL('https://translate.googleapis.com/translate_a/single');
      url.searchParams.set('client', 'gtx');
      url.searchParams.set('sl', 'en');
      url.searchParams.set('tl', 'zh-CN');
      url.searchParams.set('dt', 't');
      url.searchParams.set('q', text);

      const response = await requestText(url.toString(), 12000);
      const payload = JSON.parse(response);
      const translated = Array.isArray(payload?.[0])
        ? payload[0].map((part: any[]) => part?.[0] || '').join('').trim()
        : text;

      translationCache.set(text, translated || text);
      return translated || text;
    } catch (error) {
      console.error('Failed to translate doodle text:', error);
      translationCache.set(text, text);
      return text;
    }
  }
  
  async function requestText(url: string, timeoutMs = 15000) {
    return new Promise<string>((resolve, reject) => {
      import('https').then(https => {
        const req = https.get(url, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${url} returned ${res.statusCode}`));
            res.resume();
            return;
          }

          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => resolve(data));
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
      });
    });
  }

  async function requestBinary(url: string, timeoutMs = 20000) {
    return new Promise<{ body: Buffer; contentType: string }>((resolve, reject) => {
      import('https').then(https => {
        const req = https.get(url, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${url} returned ${res.statusCode}`));
            res.resume();
            return;
          }

          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => resolve({
            body: Buffer.concat(chunks),
            contentType: res.headers['content-type'] || 'application/octet-stream'
          }));
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
      });
    });
  }

  function isAllowedDoodleImage(url: string) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' &&
        parsed.hostname === 'www.google.com' &&
        parsed.pathname.startsWith('/logos/doodles/');
    } catch {
      return false;
    }
  }

  function parseSitemapEntries(sitemap: string) {
    return Array.from(
      sitemap.matchAll(/<loc>https:\/\/doodles\.google\/doodle\/([^<]+)\/<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g)
    ).slice(0, HISTORY_LIMIT).map(match => ({
      slug: match[1],
      dateStr: match[2]
    }));
  }

  async function fetchArchiveLocalization(entry: { slug: string; dateStr: string }) {
    const [year, month] = entry.dateStr.split('-').map(Number);
    const url = `https://www.google.com/doodles/json/${year}/${month}?hl=zh-CN`;

    try {
      const text = await requestText(url, 12000);
      const payload = JSON.parse(text);
      if (!Array.isArray(payload)) return null;

      const match = payload.find((doodle: any) => doodle?.name === entry.slug);
      if (!match) return null;

      return {
        title: decodeHtml(match.title || ''),
        share_text: decodeHtml(match.share_text || match.translated_blog_posts?.[0]?.title || '')
      };
    } catch {
      return null;
    }
  }

  async function fetchDoodle(entry: { slug: string; dateStr: string }) {
    const html = await requestText(`https://doodles.google/doodle/${entry.slug}/?hl=zh-CN`);
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const ogImageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    const shareTextMatch = html.match(/<meta property="og:description" content="([^"]+)"/);

    let title = titleMatch ? decodeHtml(titleMatch[1]) : entry.slug;
    title = title.replace(/ Doodle - Google Doodles$/, '');

    const [year, month, day] = entry.dateStr.split('-').map(Number);

    const shareText = shareTextMatch ? decodeHtml(shareTextMatch[1]) : '';
    const archiveLocalization = await fetchArchiveLocalization(entry);
    const [translatedTitle, translatedShareText] = await Promise.all([
      translateToSimplifiedChinese(archiveLocalization?.title || title),
      translateToSimplifiedChinese(archiveLocalization?.share_text || shareText)
    ]);
    const titleZh = archiveLocalization?.title || translatedTitle;
    const shareTextZh = archiveLocalization?.share_text || translatedShareText;

    return {
      name: entry.slug,
      title,
      url: ogImageMatch ? decodeHtml(ogImageMatch[1]) : null,
      share_text: shareText,
      run_date_array: [year, month, day],
      localized: {
        en: {
          title,
          share_text: shareText
        },
        'zh-CN': {
          title: titleZh,
          share_text: shareTextZh
        }
      }
    };
  }
  
  async function fetchDoodleHistory() {
    if (doodleCache && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
      return doodleCache;
    }

    try {
      const sitemap = await requestText('https://doodles.google/sitemap.xml', 20000);
      const entries = parseSitemapEntries(sitemap);

      if (!entries.length) return doodleCache;

      const settled = await Promise.allSettled(entries.map(fetchDoodle));
      doodleCache = settled
        .filter(result => result.status === 'fulfilled')
        .map(result => result.value)
        .filter(doodle => doodle.url);
      lastFetchTime = Date.now();
      
      return doodleCache;
    } catch (error) {
      console.error('Failed to fetch doodle:', error);
      return doodleCache; 
    }
  }

  // API Routes
  app.get('/api/doodle/latest', async (req, res) => {
    const doodles = await fetchDoodleHistory();
    const doodle = doodles?.[0];
    if (doodle) {
      res.json(doodle);
    } else {
      res.status(404).json({ error: 'No doodles found' });
    }
  });

  app.get('/api/doodle/history', async (req, res) => {
    const doodles = await fetchDoodleHistory();
    if (doodles?.length) {
      res.json(doodles);
    } else {
      res.status(404).json({ error: 'No doodles found' });
    }
  });

  app.get('/api/doodle/image', async (req, res) => {
    const imageUrl = String(req.query.url || '');

    if (!isAllowedDoodleImage(imageUrl)) {
      res.status(400).json({ error: 'Unsupported doodle image URL' });
      return;
    }

    try {
      const cached = imageCache.get(imageUrl);
      const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
      const image = fresh ? cached : await requestBinary(imageUrl);

      if (!fresh) {
        imageCache.set(imageUrl, { ...image, fetchedAt: Date.now() });
      }

      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(image.body);
    } catch (error) {
      console.error('Failed to proxy doodle image:', error);
      res.status(502).json({ error: 'Failed to load doodle image' });
    }
  });

  app.get('/api/visitor-timezone', async (req, res) => {
    const ip = clientIp(req);
    const timeZone = await fetchTimeZoneForIp(ip);
    res.json({ timeZone, source: timeZone ? 'ip' : 'browser-fallback' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
