import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const doodleDir = path.join(rootDir, 'public', 'doodles');
const manifestPath = path.join(doodleDir, 'manifest.json');
const translationCachePath = path.join(doodleDir, 'translations.zh-CN.json');
const archiveModulePath = path.join(rootDir, 'doodleArchive.ts');
const monthsToFetch = Number(process.env.DOODLE_MONTHS || 12);
const maxEntries = Number(process.env.DOODLE_LIMIT || 120);
const offlineOnly = process.env.DOODLE_OFFLINE === '1';
const onlineTranslate = process.env.DOODLE_TRANSLATE !== '0' && !offlineOnly;
const refreshTranslations = process.env.DOODLE_TRANSLATE_REFRESH === '1';
let translationCache = {};
let translationCacheDirty = false;

const headers = {
  'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7'
};

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

function safeFilePart(value = '') {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/giu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'doodle';
}

function absoluteDoodleImageUrl(value = '') {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `https://www.google.com${value}`;
  return value;
}

function extensionFromUrl(url) {
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(extension) ? extension : '.png';
}

function localDateFromDoodle(doodle) {
  const [year, month, day] = doodle.run_date_array || [];
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function titleFromLocalImageName(name) {
  return name
    .split('-')
    .filter(Boolean)
    .map(part => (/^\d+$/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

function hasChinese(value = '') {
  return /[\u3400-\u9fff]/u.test(value);
}

function normalizeLocalizedZhTitle(value = '') {
  let title = value
    .replace(/\((\d{1,2})月(\d{1,2})日\)/gu, '（$1月$2日）')
    .replace(/\s+/g, ' ')
    .trim();

  const trailingYear = title.match(/^(.+?)\s+(20\d{2})(\s*（[^）]+）)?$/u);
  if (trailingYear) {
    const [, name, year, date = ''] = trailingYear;
    title = `${year} 年${name.trim()}${date.trim()}`;
  }

  return title
    .replace(/\bUS\b/giu, '美国')
    .replace(/日 of the Dead/giu, '亡灵节')
    .replace(/Unity 日/giu, '统一日')
    .replace(/Veterans 日/giu, '退伍军人节')
    .replace(/Native American/giu, '美洲原住民')
    .replace(/Around the/giu, '环绕')
    .replace(/Edition/giu, '特别版')
    .replace(/Playoffs/giu, '季后赛')
    .replace(/Fall Classic/giu, '秋季经典赛')
    .replace(/(.+?)(20\d{2})(特别版)$/u, '$2年$1$3')
    .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/gu, '$1$2')
    .replace(/([\u3400-\u9fff])\s+(\d)/gu, '$1$2')
    .replace(/(\d)\s+([\u3400-\u9fff])/gu, '$1$2')
    .replace(/\s+（/g, '（')
    .replace(/\s+/g, ' ')
    .trim();
}

function localizeTitleZh(value = '') {
  let title = value
    .replace(/\s+/g, ' ')
    .replace(/\s+Doodle\s+-\s+Google Doodles$/i, '')
    .trim();

  title = title.replace(/\((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2})\)/gi, (_, monthName, day) => {
    const months = {
      jan: 1,
      feb: 2,
      mar: 3,
      apr: 4,
      may: 5,
      jun: 6,
      jul: 7,
      aug: 8,
      sep: 9,
      oct: 10,
      nov: 11,
      dec: 12
    };
    const month = months[monthName.slice(0, 3).toLowerCase()];
    return month ? `(${month}月${Number(day)}日)` : `(${monthName} ${day})`;
  });

  const orderedRules = [
    [/\bDay of the Dead\b/gi, '亡灵节'],
    [/\bGerman Unity Day\b/gi, '德国统一日'],
    [/\bMother's Day\b/gi, '母亲节'],
    [/\bFather's Day\b/gi, '父亲节'],
    [/\bTeacher Appreciation Day\b/gi, '教师感谢日'],
    [/\bInternational Women's Day\b/gi, '国际妇女节'],
    [/\bWomen's Day\b/gi, '妇女节'],
    [/\bEarth Day\b/gi, '地球日'],
    [/\bLabou?r Day\b/gi, '劳动节'],
    [/\bNew Year's Day\b/gi, '元旦'],
    [/\bLunar New Year\b/gi, '农历新年'],
    [/\bSpring Festival\b/gi, '春节'],
    [/\bMid-Autumn Festival\b/gi, '中秋节'],
    [/\bDragon Boat Festival\b/gi, '端午节'],
    [/\bValentine's Day\b/gi, '情人节'],
    [/\bChristmas\b/gi, '圣诞节'],
    [/\bHalloween\b/gi, '万圣节'],
    [/\bThanksgiving\b/gi, '感恩节'],
    [/\bEaster\b/gi, '复活节'],
    [/\bNational Day\b/gi, '国庆日'],
    [/\bRepublic Day\b/gi, '共和国日'],
    [/\bIndependence Day\b/gi, '独立日'],
    [/\bFreedom Day\b/gi, '自由日'],
    [/\bNational Elections?\b/gi, '全国选举'],
    [/\bLegislative Elections?\b/gi, '立法选举'],
    [/\bPresidential Election\b/gi, '总统选举'],
    [/\bElections?\b/gi, '选举'],
    [/\bCelebrating the\b/gi, '纪念'],
    [/\bCelebrating\b/gi, '纪念'],
    [/\bLearning about\b/gi, '学习'],
    [/\bThe Art of\b/gi, '艺术:'],
    [/\bWorld\b/gi, '世界'],
    [/\bDay\b/gi, '日'],
    [/\bCentennial\b/gi, '百年纪念'],
    [/\bFinalists?\b/gi, '入围者'],
    [/\bNative American\b/gi, '美洲原住民'],
    [/\bCzech Republic\b/gi, '捷克共和国'],
    [/\bSouth Africa\b/gi, '南非'],
    [/\bTürkiye\b/gi, '土耳其'],
    [/\bTurkey\b/gi, '土耳其'],
    [/\bPoland\b/gi, '波兰'],
    [/\bGermany\b/gi, '德国'],
    [/\bGerman\b/gi, '德国'],
    [/\bNetherlands\b/gi, '荷兰'],
    [/\bArgentina\b/gi, '阿根廷'],
    [/\bIreland\b/gi, '爱尔兰'],
    [/\bK-Pop\b/gi, 'K-Pop'],
    [/\bUS\b/gi, '美国'],
    [/\bDance\b/gi, '舞蹈'],
    [/\bNASA's\b/gi, 'NASA'],
    [/\bMission\b/gi, '任务'],
    [/\bAround the\b/gi, '环绕'],
    [/\bMoon\b/gi, '月球'],
    [/\bPhotosynthesis\b/gi, '光合作用'],
    [/\bDNA\b/gi, 'DNA'],
    [/\bQuantum\b/gi, '量子'],
    [/\bRoute 66\b/gi, '66号公路'],
    [/\bPAC-MAN\b/gi, '吃豆人'],
    [/\bEdition\b/gi, '特别版'],
    [/\bFlutes\b/gi, '长笛'],
    [/\bIdli\b/gi, '伊德利米糕']
  ];

  for (const [pattern, replacement] of orderedRules) {
    title = title.replace(pattern, replacement);
  }

  return normalizeLocalizedZhTitle(title)
    .replace(/\s*:\s*/g, ': ')
    .trim();
}

async function translateTextZh(value = '') {
  const text = value.trim();
  if (!text) return text;

  const url = new URL('https://translate.googleapis.com/translate_a/single');
  url.searchParams.set('client', 'gtx');
  url.searchParams.set('sl', 'en');
  url.searchParams.set('tl', 'zh-CN');
  url.searchParams.set('dt', 't');
  url.searchParams.set('q', text);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Google Translate returned ${response.status}`);
    }

    const payload = await response.json();
    const translated = Array.isArray(payload?.[0])
      ? payload[0].map(part => part?.[0] || '').join('').trim()
      : '';

    if (!translated) {
      throw new Error('Google Translate returned an empty translation');
    }

    return decodeHtml(translated);
  } finally {
    clearTimeout(timeout);
  }
}

async function translateDoodleZh(doodle) {
  const cached = translationCache[doodle.name];
  const sourceTitle = doodle.title || doodle.name;

  if (cached?.title && !refreshTranslations && (!cached.source_title || cached.source_title === sourceTitle)) {
    return {
      title: normalizeLocalizedZhTitle(cached.title),
      share_text: cached.share_text || `${normalizeLocalizedZhTitle(cached.title)}的 Google Doodle 纪念作品。`
    };
  }

  if (onlineTranslate) {
    try {
      const [translatedTitle, translatedShareText] = await Promise.all([
        translateTextZh(sourceTitle),
        translateTextZh(doodle.share_text || sourceTitle)
      ]);
      const title = normalizeLocalizedZhTitle(translatedTitle);
      const shareText = translatedShareText || `${title}的 Google Doodle 纪念作品。`;

      translationCache[doodle.name] = {
        title,
        share_text: shareText,
        source_title: sourceTitle,
        updated_at: new Date().toISOString()
      };
      translationCacheDirty = true;

      return { title, share_text: shareText };
    } catch (error) {
      console.warn(`Google Translate unavailable for ${doodle.name}: ${error instanceof Error ? error.message : error}`);
    }
  }

  const zh = doodle.localized?.['zh-CN'] || {};
  const title = hasChinese(zh.title)
    ? normalizeLocalizedZhTitle(zh.title)
    : localizeTitleZh(zh.title || doodle.title || doodle.name);
  const shareText = hasChinese(zh.share_text) ? zh.share_text : `${title}的 Google Doodle 纪念作品。`;

  return { title, share_text: shareText };
}

async function withLocalZhFallback(doodle) {
  const zh = await translateDoodleZh(doodle);

  return {
    ...doodle,
    localized: {
      ...(doodle.localized || {}),
      'zh-CN': zh
    }
  };
}

function previousMonth({ year, month }) {
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function recentMonths(count) {
  const months = [];
  const now = new Date();
  let current = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };

  while (months.length < count) {
    months.push(current);
    current = previousMonth(current);
  }

  return months;
}

async function readExistingManifest() {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    const payload = JSON.parse(raw);
    return Array.isArray(payload?.doodles) ? payload.doodles : [];
  } catch {
    return [];
  }
}

async function readExistingManifestPayload() {
  try {
    const raw = await readFile(manifestPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readTranslationCache() {
  try {
    const raw = await readFile(translationCachePath, 'utf8');
    const payload = JSON.parse(raw);
    return payload && typeof payload === 'object' ? payload : {};
  } catch {
    return {};
  }
}

async function writeTranslationCache() {
  if (!translationCacheDirty) return;

  const sorted = Object.fromEntries(
    Object.entries(translationCache).sort(([a], [b]) => a.localeCompare(b))
  );
  await writeFile(translationCachePath, `${JSON.stringify(sorted, null, 2)}\n`);
}

async function scanLocalImages() {
  await mkdir(doodleDir, { recursive: true });
  const files = await readdir(doodleDir);

  return files
    .filter(fileName => /\.(png|jpe?g|webp|gif|svg)$/i.test(fileName))
    .map(fileName => {
      const baseName = path.basename(fileName, path.extname(fileName));
      const match = baseName.match(/^(\d{4})-(\d{2})-(\d{2})_(.+)$/);
      if (!match) return null;

      const [, year, month, day, name] = match;
      const title = titleFromLocalImageName(name);
      return {
        name,
        title,
        url: `/doodles/${fileName}`,
        high_res_url: `/doodles/${fileName}`,
        share_text: title,
        run_date_array: [Number(year), Number(month), Number(day)],
        fileName,
        source_url: null,
        localized: {
          en: { title, share_text: title },
          'zh-CN': { title, share_text: title }
        }
      };
    })
    .filter(Boolean);
}

async function fetchArchiveMonth(year, month, language) {
  const response = await fetch(`https://www.google.com/doodles/json/${year}/${month}?hl=${language}`, { headers });
  if (!response.ok) {
    throw new Error(`Google archive ${year}-${month} ${language} returned ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  if (!contentType.includes('json') && text.trim().startsWith('<')) {
    throw new Error(`Google archive ${year}-${month} ${language} returned HTML`);
  }

  const payload = JSON.parse(text);
  return Array.isArray(payload) ? payload : [];
}

async function fetchRemoteDoodles() {
  const collected = new Map();
  const settled = await Promise.allSettled(
    recentMonths(monthsToFetch).map(async ({ year, month }) => {
      const [enArchive, zhArchive] = await Promise.all([
        fetchArchiveMonth(year, month, 'en'),
        fetchArchiveMonth(year, month, 'zh-CN')
      ]);
      return { enArchive, zhArchive };
    })
  );

  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn(result.reason instanceof Error ? result.reason.message : result.reason);
      continue;
    }

    const zhByName = new Map();
    for (const doodle of result.value.zhArchive) {
      if (doodle?.name) zhByName.set(doodle.name, doodle);
    }

    for (const doodle of result.value.enArchive) {
      if (!doodle?.name || collected.has(doodle.name)) continue;

      const imageUrl = absoluteDoodleImageUrl(doodle.high_res_url || doodle.url || doodle.alternate_url || '');
      if (!imageUrl) continue;

      const zh = zhByName.get(doodle.name);
      collected.set(doodle.name, {
        name: doodle.name,
        title: decodeHtml(doodle.title || doodle.name),
        share_text: decodeHtml(doodle.share_text || doodle.translated_blog_posts?.[0]?.title || ''),
        run_date_array: doodle.run_date_array,
        source_url: imageUrl,
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

  if (collected.size) {
    return Array.from(collected.values());
  }

  console.warn('Google monthly archive returned no entries; falling back to doodles.google sitemap.');
  return fetchDoodlesFromSitemap();
}

function parseSitemapEntries(sitemap) {
  return Array.from(
    sitemap.matchAll(/<loc>https:\/\/(?:www\.)?doodles\.google\/doodle\/([^<]+)\/<\/loc>[\s\S]*?<lastmod>([^<]+)<\/lastmod>/g)
  ).slice(0, maxEntries).map(match => ({
    slug: match[1],
    dateStr: match[2]
  }));
}

function metaContent(html, property) {
  const pattern = new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`, 'i');
  return html.match(pattern)?.[1] || '';
}

async function fetchDoodlesFromSitemap() {
  const response = await fetch('https://doodles.google/sitemap.xml', {
    headers: {
      ...headers,
      Accept: 'application/xml,text/xml,text/plain,*/*'
    }
  });

  if (!response.ok) {
    throw new Error(`doodles.google sitemap returned ${response.status}`);
  }

  const sitemap = await response.text();
  const entries = parseSitemapEntries(sitemap);
  const settled = await Promise.allSettled(entries.map(fetchDoodlePage));

  return settled
    .filter(result => result.status === 'fulfilled')
    .map(result => result.value)
    .filter(doodle => doodle.source_url)
    .slice(0, maxEntries);
}

async function fetchDoodlePage(entry) {
  const response = await fetch(`https://doodles.google/doodle/${entry.slug}/`, {
    headers: {
      ...headers,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });

  if (!response.ok) {
    throw new Error(`Doodle page ${entry.slug} returned ${response.status}`);
  }

  const html = await response.text();
  const rawTitle = decodeHtml(metaContent(html, 'og:title') || entry.slug)
    .replace(/ Doodle - Google Doodles$/, '');
  const shareText = decodeHtml(metaContent(html, 'og:description'));
  const imageUrl = absoluteDoodleImageUrl(metaContent(html, 'og:image'));
  const [year, month, day] = entry.dateStr.split('-').map(Number);

  return {
    name: entry.slug,
    title: rawTitle,
    share_text: shareText,
    run_date_array: [year, month, day],
    source_url: imageUrl,
    localized: {
      en: {
        title: rawTitle,
        share_text: shareText
      },
      'zh-CN': {
        title: rawTitle,
        share_text: shareText
      }
    }
  };
}

async function downloadImage(doodle) {
  if (!doodle.source_url) return doodle;

  const date = localDateFromDoodle(doodle);
  const extension = extensionFromUrl(doodle.source_url);
  const fileName = `${safeFilePart(date)}_${safeFilePart(doodle.name)}${extension}`;
  const filePath = path.join(doodleDir, fileName);

  try {
    await readFile(filePath);
  } catch {
    const response = await fetch(doodle.source_url, {
      headers: {
        ...headers,
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Image ${doodle.source_url} returned ${response.status}`);
    }

    const body = Buffer.from(await response.arrayBuffer());
    await writeFile(filePath, body);
  }

  return {
    ...doodle,
    fileName,
    url: `/doodles/${fileName}`,
    high_res_url: `/doodles/${fileName}`
  };
}

function sortDoodles(doodles) {
  return doodles
    .filter(doodle => Array.isArray(doodle.run_date_array) && doodle.fileName)
    .sort((a, b) => b.run_date_array.join('').localeCompare(a.run_date_array.join('')))
    .slice(0, maxEntries);
}

async function writeArchive(doodles) {
  const localized = [];

  for (const doodle of doodles) {
    localized.push(await withLocalZhFallback(doodle));
  }

  const sorted = sortDoodles(localized);
  const existing = await readExistingManifestPayload();
  const unchanged = JSON.stringify(existing?.doodles || []) === JSON.stringify(sorted);
  const manifest = {
    updated_at: unchanged && existing?.updated_at ? existing.updated_at : new Date().toISOString(),
    count: sorted.length,
    doodles: sorted
  };

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await writeTranslationCache();
  await writeFile(
    archiveModulePath,
    `export const localDoodleArchive = ${JSON.stringify(sorted, null, 2)} as const;\n\n` +
      `export const localDoodleFiles = localDoodleArchive.map(doodle => doodle.fileName);\n`
  );

  console.log(`Wrote ${sorted.length} doodles to public/doodles/manifest.json and doodleArchive.ts`);
}

async function main() {
  translationCache = await readTranslationCache();
  const existing = await readExistingManifest();
  const local = await scanLocalImages();
  const byName = new Map([...local, ...existing].map(doodle => [doodle.name, doodle]));

  if (!offlineOnly) {
    const remote = await fetchRemoteDoodles();
    for (const doodle of remote) {
      try {
        byName.set(doodle.name, await downloadImage(doodle));
      } catch (error) {
        console.warn(error instanceof Error ? error.message : error);
      }
    }
  }

  await writeArchive(Array.from(byName.values()));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
