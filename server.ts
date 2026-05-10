import { HttpsProxyAgent } from "https-proxy-agent";
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { localDoodleArchive, localDoodleFiles } from './doodleArchive';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const bundledLocalDoodleFileSet = new Set<string>(localDoodleFiles);

export async function createApp() {
  const app = express();
  // Doodle Cache Strategy
  let doodleCache: any[] | null = null;
  let lastFetchTime: number = 0;
  const CACHE_TTL_MS = 1000 * 60 * 60; // revalidate at most once per hour
  const RECENT_DOODLE_LIMIT = 30;
  const imageCache = new Map<string, { body: Buffer; contentType: string; fetchedAt: number }>();
  const localImageDirs = Array.from(new Set([
    path.join(process.cwd(), 'public', 'doodles'),
    path.join(process.cwd(), 'dist', 'doodles'),
    path.join(__dirname, 'public', 'doodles'),
    path.join(__dirname, 'dist', 'doodles')
  ]));
  const translationCache = new Map<string, string>();
  const timeZoneCache = new Map<string, { timeZone: string | null; fetchedAt: number }>();

  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.ALL_PROXY;
  const proxyAgent = proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined;

  if (proxyUrl) {
    console.log(`Using outbound proxy: ${proxyUrl}`);
  }

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
        const req = https.get(url, proxyAgent ? { agent: proxyAgent } : {}, (res) => {
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
        const req = https.get(url, proxyAgent ? { agent: proxyAgent } : {}, (res) => {
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

  async function requestHead(url: string, timeoutMs = 10000) {
    return new Promise<{ statusCode: number; contentType: string }>((resolve, reject) => {
      import('https').then(https => {
        const req = https.request(url, {
          method: 'HEAD',
          ...(proxyAgent ? { agent: proxyAgent } : {})
        }, (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`${url} returned ${res.statusCode}`));
            res.resume();
            return;
          }

          resolve({
            statusCode: res.statusCode || 0,
            contentType: String(res.headers['content-type'] || '')
          });
          res.resume();
        });

        req.setTimeout(timeoutMs, () => {
          req.destroy(new Error(`${url} timed out after ${timeoutMs}ms`));
        });
        req.on('error', reject);
        req.end();
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

  function safeFilePart(value = '') {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 96) || 'doodle';
  }

  function contentTypeFromExtension(extension: string) {
    switch (extension) {
      case '.jpg':
      case '.jpeg':
        return 'image/jpeg';
      case '.webp':
        return 'image/webp';
      case '.gif':
        return 'image/gif';
      case '.svg':
        return 'image/svg+xml';
      case '.png':
      default:
        return 'image/png';
    }
  }

  function extensionFromContentType(contentType = '') {
    if (contentType.includes('jpeg')) return '.jpg';
    if (contentType.includes('webp')) return '.webp';
    if (contentType.includes('gif')) return '.gif';
    if (contentType.includes('svg')) return '.svg';
    return '.png';
  }

  function extensionFromUrl(url: string) {
    try {
      const extension = path.extname(new URL(url).pathname).toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension) ? extension : '';
    } catch {
      return '';
    }
  }

  function localImageBaseName(date: string, name: string) {
    return `${safeFilePart(date)}_${safeFilePart(name)}`;
  }

  async function readLocalDoodleImage(baseName: string) {
    const extensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

    for (const directory of localImageDirs) {
      for (const extension of extensions) {
        const filePath = path.join(directory, `${baseName}${extension}`);

        try {
          const body = await readFile(filePath);
          return {
            body,
            contentType: contentTypeFromExtension(extension),
            filePath
          };
        } catch {
          // Try the next extension/directory.
        }
      }
    }

    return null;
  }

  async function writeLocalDoodleImage(baseName: string, imageUrl: string, image: { body: Buffer; contentType: string }) {
    const extension = extensionFromUrl(imageUrl) || extensionFromContentType(image.contentType);
    const filePath = path.join(localImageDirs[0], `${baseName}${extension}`);

    await mkdir(localImageDirs[0], { recursive: true });
    await writeFile(filePath, image.body);

    return filePath;
  }

  async function localDoodleImageFiles() {
    const files = new Map<string, string>();

    for (const fileName of localDoodleFiles) {
      files.set(path.basename(fileName, path.extname(fileName)), fileName);
    }

    for (const directory of localImageDirs) {
      try {
        const entries = await readdir(directory);
        for (const fileName of entries) {
          const extension = path.extname(fileName).toLowerCase();
          if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension)) continue;
          files.set(path.basename(fileName, extension), fileName);
        }
      } catch {
        // The directory may not exist in every runtime; try the next one.
      }
    }

    return files;
  }

  function localDoodleStaticPath(value: string) {
    if (!value.startsWith('/doodles/')) return null;

    const fileName = path.basename(value);
    if (!bundledLocalDoodleFileSet.has(fileName)) return null;

    return `/doodles/${fileName}`;
  }

  function titleFromLocalImageName(name: string) {
    return name
      .split('-')
      .filter(Boolean)
      .map(part => {
        if (/^\d+$/.test(part)) return part;
        return part.charAt(0).toUpperCase() + part.slice(1);
      })
      .join(' ');
  }

  async function localDoodleFallback() {
    const files = await localDoodleImageFiles();
    const generatedDoodles = localDoodleArchive
      .filter(doodle => files.has(path.basename(doodle.fileName, path.extname(doodle.fileName))))
      .map(doodle => ({
        ...doodle,
        url: `/doodles/${doodle.fileName}`,
        high_res_url: `/doodles/${doodle.fileName}`
      }));
    const knownNames = new Set(generatedDoodles.map(doodle => doodle.name));
    const scannedDoodles = Array.from(files.entries())
      .map(([baseName, fileName]) => {
        const match = baseName.match(/^(\d{4})-(\d{2})-(\d{2})_(.+)$/);
        if (!match) return null;

        const [, year, month, day, name] = match;
        const title = titleFromLocalImageName(name);
        const localUrl = `/doodles/${fileName}`;

        return {
          name,
          title,
          url: localUrl,
          high_res_url: localUrl,
          share_text: title,
          run_date_array: [Number(year), Number(month), Number(day)],
          localized: {
            en: {
              title,
              share_text: title
            },
            'zh-CN': {
              title,
              share_text: title
            }
          }
        };
      })
      .filter(Boolean)
      .filter((doodle: any) => !knownNames.has(doodle.name));

    const doodles = [...generatedDoodles, ...scannedDoodles]
      .sort((a: any, b: any) => {
        const dateA = Array.isArray(a.run_date_array) ? a.run_date_array.join('') : '';
        const dateB = Array.isArray(b.run_date_array) ? b.run_date_array.join('') : '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, RECENT_DOODLE_LIMIT);

    return doodles as any[];
  }

  function parseSitemapEntries(sitemap: string) {
    return Array.from(
      sitemap.matchAll(/<loc>https:\/\/doodles\.google\/doodle\/([^<]+)\/<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g)
    ).slice(0, RECENT_DOODLE_LIMIT).map(match => ({
      slug: match[1],
      dateStr: match[2]
    }));
  }

  function recentDoodles() {
    return (doodleCache ?? []).slice(0, RECENT_DOODLE_LIMIT);
  }

  function mergeDoodleCache(fetchedDoodles: any[]) {
    const merged = new Map<string, any>();

    for (const doodle of fetchedDoodles) {
      if (doodle?.name) {
        merged.set(doodle.name, doodle);
      }
    }

    for (const doodle of doodleCache ?? []) {
      if (doodle?.name && !merged.has(doodle.name)) {
        merged.set(doodle.name, doodle);
      }
    }

    doodleCache = Array.from(merged.values()).sort((a, b) => {
      const dateA = Array.isArray(a.run_date_array) ? a.run_date_array.join('') : '';
      const dateB = Array.isArray(b.run_date_array) ? b.run_date_array.join('') : '';
      return dateB.localeCompare(dateA);
    });
  }

  function absoluteDoodleImageUrl(value = '') {
    if (!value) return null;
    if (value.startsWith('//')) return `https:${value}`;
    if (value.startsWith('/')) return `https://www.google.com${value}`;
    return value;
  }

  function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  function canRefresh(req: express.Request) {
    const secret = process.env.CRON_SECRET || process.env.DOODLE_REFRESH_SECRET;
    if (!secret) return true;

    const authorization = String(req.headers.authorization || '');
    return authorization === `Bearer ${secret}` || req.query.secret === secret;
  }

  function previousMonth(year: number, month: number) {
    if (month === 1) {
      return { year: year - 1, month: 12 };
    }

    return { year, month: month - 1 };
  }

  function recentMonths(count: number) {
    const months: Array<{ year: number; month: number }> = [];
    const now = new Date();
    let year = now.getUTCFullYear();
    let month = now.getUTCMonth() + 1;

    while (months.length < count) {
      months.push({ year, month });
      const previous = previousMonth(year, month);
      year = previous.year;
      month = previous.month;
    }

    return months;
  }

  async function fetchArchiveMonth(year: number, month: number, language: 'en' | 'zh-CN', timeoutMs = 15000) {
    const url = `https://www.google.com/doodles/json/${year}/${month}?hl=${language}`;
    const text = await requestText(url, timeoutMs);
    const payload = JSON.parse(text);
    return Array.isArray(payload) ? payload : [];
  }

  async function fetchRecentArchiveDoodles(maxMonths = 18, timeoutMs = 15000) {
    const collected = new Map<string, any>();
    const settledMonths = await Promise.allSettled(
      recentMonths(maxMonths).map(async ({ year, month }) => {
        const [enArchive, zhArchive] = await Promise.all([
          fetchArchiveMonth(year, month, 'en', timeoutMs),
          fetchArchiveMonth(year, month, 'zh-CN', timeoutMs)
        ]);

        return { year, month, enArchive, zhArchive };
      })
    );

    for (const result of settledMonths) {
      if (result.status === 'rejected') {
        console.warn(`Failed to fetch archive month: ${errorMessage(result.reason)}`);
        continue;
      }

      const { enArchive, zhArchive } = result.value;
      const zhByName = new Map<string, any>();
      for (const doodle of zhArchive) {
        if (doodle?.name) {
          zhByName.set(doodle.name, doodle);
        }
      }

      for (const doodle of enArchive) {
        if (!doodle?.name || collected.has(doodle.name)) continue;

        const zh = zhByName.get(doodle.name);
        const imageUrl = absoluteDoodleImageUrl(doodle.high_res_url || doodle.url || doodle.alternate_url || '');
        if (!imageUrl) continue;

        collected.set(doodle.name, {
          name: doodle.name,
          title: decodeHtml(doodle.title || doodle.name),
          url: imageUrl,
          high_res_url: imageUrl,
          share_text: decodeHtml(doodle.share_text || doodle.translated_blog_posts?.[0]?.title || ''),
          run_date_array: doodle.run_date_array,
          localized: {
            en: {
              title: decodeHtml(doodle.title || doodle.name),
              share_text: decodeHtml(doodle.share_text || doodle.translated_blog_posts?.[0]?.title || '')
            },
            'zh-CN': {
              title: decodeHtml(zh?.title || doodle.title || doodle.name),
              share_text: decodeHtml(zh?.share_text || zh?.translated_blog_posts?.[0]?.title || doodle.share_text || '')
            }
          }
        });
      }
    }

    return Array.from(collected.values())
      .sort((a, b) => {
        const dateA = Array.isArray(a.run_date_array) ? a.run_date_array.join('') : '';
        const dateB = Array.isArray(b.run_date_array) ? b.run_date_array.join('') : '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, RECENT_DOODLE_LIMIT);
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

  async function fetchRemoteDoodleHistory(maxMonths = 6, timeoutMs = 12000) {
    const archiveDoodles = await fetchRecentArchiveDoodles(maxMonths, timeoutMs);

    if (archiveDoodles.length) {
      return archiveDoodles;
    }

    const sitemap = await requestText('https://doodles.google/sitemap.xml', timeoutMs);
    const entries = parseSitemapEntries(sitemap);

    if (!entries.length) return [];

    const settled = await Promise.allSettled(entries.map(fetchDoodle));
    return settled
      .filter(result => result.status === 'fulfilled')
      .map(result => result.value)
      .filter(doodle => doodle.url)
      .sort((a, b) => {
        const dateA = Array.isArray(a.run_date_array) ? a.run_date_array.join('') : '';
        const dateB = Array.isArray(b.run_date_array) ? b.run_date_array.join('') : '';
        return dateB.localeCompare(dateA);
      })
      .slice(0, RECENT_DOODLE_LIMIT);
  }

  async function refreshRemoteDoodleCache() {
    const remoteDoodles = await fetchRemoteDoodleHistory();

    if (!remoteDoodles.length) {
      throw new Error('Remote Doodle archive returned no usable entries');
    }

    mergeDoodleCache(remoteDoodles);
    lastFetchTime = Date.now();
    return recentDoodles();
  }

  async function useLocalFallback() {
    const fallbackDoodles = await localDoodleFallback();

    if (fallbackDoodles.length) {
      mergeDoodleCache(fallbackDoodles);
      lastFetchTime = Date.now();
      return recentDoodles();
    }

    return doodleCache?.length ? recentDoodles() : null;
  }
  
  async function fetchDoodleHistory() {
    if (doodleCache?.length && (Date.now() - lastFetchTime < CACHE_TTL_MS)) {
      return recentDoodles();
    }

    if (process.env.VERCEL === '1' || process.env.DOODLE_SOURCE === 'local') {
      const fallback = await useLocalFallback();
      if (fallback?.length) return fallback;
    }

    try {
      return await refreshRemoteDoodleCache();
    } catch (error) {
      console.error('Failed to fetch doodle:', error);
      return useLocalFallback();
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

  app.get('/api/doodle/health', async (req, res) => {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();
    const localDoodles = await localDoodleFallback();
    const remoteArchive = {
      ok: false,
      count: 0,
      latest: null as string | null,
      error: null as string | null
    };
    const sampleImage = {
      ok: false,
      statusCode: 0,
      contentType: '',
      url: null as string | null,
      error: null as string | null
    };

    try {
      const remoteDoodles = await fetchRemoteDoodleHistory(3, 8000);
      remoteArchive.count = remoteDoodles.length;
      remoteArchive.latest = remoteDoodles[0]?.name || null;
      remoteArchive.ok = remoteDoodles.length > 0;

      const imageUrl = absoluteDoodleImageUrl(remoteDoodles[0]?.high_res_url || remoteDoodles[0]?.url || '');
      sampleImage.url = imageUrl;

      if (imageUrl && isAllowedDoodleImage(imageUrl)) {
        const imageCheck = await requestHead(imageUrl);
        sampleImage.statusCode = imageCheck.statusCode;
        sampleImage.contentType = imageCheck.contentType;
        sampleImage.ok = imageCheck.contentType.startsWith('image/');
      } else if (imageUrl) {
        sampleImage.error = 'Sample image URL is not an allowed Google Doodle image URL';
      } else {
        sampleImage.error = 'Remote archive returned no sample image URL';
      }
    } catch (error) {
      remoteArchive.error = errorMessage(error);
      sampleImage.error = sampleImage.error || 'Skipped because remote archive check failed';
    }

    const cacheAgeSeconds = lastFetchTime ? Math.round((Date.now() - lastFetchTime) / 1000) : null;
    const localFallback = {
      ok: localDoodles.length > 0,
      count: localDoodles.length,
      latest: localDoodles[0]?.name || null
    };
    const ok = remoteArchive.ok || localFallback.ok;

    res.status(ok ? 200 : 503).json({
      ok,
      checkedAt,
      environment: {
        vercel: process.env.VERCEL === '1',
        sourcePreference: process.env.DOODLE_SOURCE || (process.env.VERCEL === '1' ? 'local-on-vercel' : 'remote-first')
      },
      source: remoteArchive.ok ? 'remote' : localFallback.ok ? 'local-fallback' : 'none',
      remoteArchive,
      sampleImage,
      localFallback,
      cache: {
        count: recentDoodles().length,
        ageSeconds: cacheAgeSeconds
      },
      durationMs: Date.now() - startedAt
    });
  });

  app.all('/api/doodle/refresh', async (req, res) => {
    if (!canRefresh(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized refresh request' });
      return;
    }

    const startedAt = Date.now();

    try {
      const doodles = await refreshRemoteDoodleCache();
      res.json({
        ok: true,
        source: 'remote',
        refreshedAt: new Date(lastFetchTime).toISOString(),
        count: doodles.length,
        latest: doodles[0]?.name || null,
        durationMs: Date.now() - startedAt
      });
    } catch (error) {
      const localDoodles = await localDoodleFallback();
      res.status(502).json({
        ok: false,
        source: localDoodles.length ? 'local-fallback' : 'none',
        error: errorMessage(error),
        localFallback: {
          ok: localDoodles.length > 0,
          count: localDoodles.length,
          latest: localDoodles[0]?.name || null
        },
        cache: {
          count: recentDoodles().length,
          ageSeconds: lastFetchTime ? Math.round((Date.now() - lastFetchTime) / 1000) : null
        },
        durationMs: Date.now() - startedAt
      });
    }
  });

  app.get('/api/doodle/image', async (req, res) => {
    const imageUrl = String(req.query.url || '');
    const imageName = String(req.query.name || 'doodle');
    const imageDate = String(req.query.date || 'undated');
    const imageBaseName = localImageBaseName(imageDate, imageName);

    try {
      const localImage = await readLocalDoodleImage(imageBaseName);

      if (localImage) {
        res.setHeader('Content-Type', localImage.contentType);
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Doodle-Image-Source', 'local-file');
        res.send(localImage.body);
        return;
      }

      const staticDoodlePath = localDoodleStaticPath(imageUrl);
      if (staticDoodlePath) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.setHeader('X-Doodle-Image-Source', 'static-redirect');
        res.redirect(307, staticDoodlePath);
        return;
      }

      if (!isAllowedDoodleImage(imageUrl)) {
        res.status(400).json({ error: 'Unsupported doodle image URL' });
        return;
      }

      const cached = imageCache.get(imageUrl);
      const fresh = cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS;
      const image = fresh ? cached : await requestBinary(imageUrl);

      if (!fresh) {
        imageCache.set(imageUrl, { ...image, fetchedAt: Date.now() });
      }

      try {
        await writeLocalDoodleImage(imageBaseName, imageUrl, image);
      } catch (error) {
        console.warn('Failed to persist doodle image cache:', error);
      }

      res.setHeader('Content-Type', image.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Doodle-Image-Source', 'downloaded-and-saved');
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

  return app;
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const app = await createApp();

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.VERCEL !== '1') {
  startServer();
}
