import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Share2,
  X
} from 'lucide-react';

interface Doodle {
  name: string;
  title: string;
  url: string;
  high_res_url?: string;
  run_date_array: [number, number, number];
  share_text: string;
  localized?: {
    en?: {
      title: string;
      share_text: string;
    };
    'zh-CN'?: {
      title: string;
      share_text: string;
    };
  };
}

interface CardMetrics {
  color: string;
  palette: [string, string, string];
  imageWidth: number;
  imageHeight: number;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
}

const cardOffsets = [-2, -1, 0, 1, 2];
const cardViewportRatio = 2.6;
type Language = 'zh-CN' | 'en';

const languageStorageKey = 'doodle-language';

function storedLanguage(): Language {
  if (typeof window === 'undefined') return 'zh-CN';

  const value = window.localStorage.getItem(languageStorageKey);
  return value === 'en' || value === 'zh-CN' ? value : 'zh-CN';
}

const copy = {
  'zh-CN': {
    appTitle: '每日 Doodle',
    gallery: '涂鸦画廊',
    loading: '正在定位今日作品',
    archiveError: '暂时无法连接 Doodle 归档。',
    retry: '重试',
    explore: '探索',
    footer: '作品版权归 Google 所有',
    previous: '上一张 Doodle',
    next: '下一张 Doodle',
    fallbackDescription: '来自 Google Doodles 的最新纪念作品。',
    languageLabel: '切换语言',
    celebrationPrefix: '节快乐',
    share: '分享',
    shareWith: '选择分享渠道',
    systemShare: '系统分享',
    copyLink: '复制链接',
    copied: '已复制分享链接',
    shareFallback: '浏览器未打开系统分享，已复制链接。',
    closeShare: '关闭分享',
    weibo: '微博'
  },
  en: {
    appTitle: 'Daily Doodle',
    gallery: 'Doodle gallery',
    loading: 'Locating artwork',
    archiveError: 'Doodle archive is unreachable.',
    retry: 'Retry',
    explore: 'Explore',
    footer: 'Artwork © Google',
    previous: 'Previous Doodle',
    next: 'Next Doodle',
    fallbackDescription: 'A recent commemorative artwork from Google Doodles.',
    languageLabel: 'Switch language',
    celebrationPrefix: 'Happy',
    share: 'Share',
    shareWith: 'Choose a channel',
    systemShare: 'System share',
    copyLink: 'Copy link',
    copied: 'Share link copied',
    shareFallback: 'System share is unavailable, so the link was copied.',
    closeShare: 'Close share',
    weibo: 'Weibo'
  }
};

const monthMap: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12
};

const importantHolidayPattern = /mother|father|teacher|labou?r|new-year|new year|valentine|earth-day|earth day|women|children|independence|national|christmas|halloween|thanksgiving|equinox|solstice|lunar|spring-festival|festival|母亲|父亲|教师|劳动|新年|春节|情人|地球|儿童|国庆|圣诞|感恩|节/iu;

function positiveModulo(value: number, length: number) {
  return ((value % length) + length) % length;
}

function formatDate(dateArray: [number, number, number], language: Language) {
  const [year, month, day] = dateArray;
  return new Intl.DateTimeFormat(language, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(year, month - 1, day));
}

function localizedText(doodle: Doodle, language: Language) {
  const local = doodle.localized?.[language] || {
    title: doodle.title,
    share_text: doodle.share_text
  };

  if (language !== 'zh-CN') {
    return local;
  }

  const title = hasChinese(local.title)
    ? normalizeLocalizedZhTitle(local.title)
    : localizeTitleZh(local.title || doodle.title || doodle.name);
  const shareText = hasChinese(local.share_text) ? local.share_text : `${title}的 Google Doodle 纪念作品。`;

  return {
    title,
    share_text: shareText
  };
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
    const month = monthMap[monthName.toLowerCase()];
    return month ? `(${month}月${Number(day)}日)` : `(${monthName} ${day})`;
  });

  const orderedRules: Array<[RegExp, string]> = [
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

function removeTitleDate(value = '') {
  return value
    .replace(/[（(][^（）()]*\d{1,2}\s*[月\/.-]\s*\d{1,2}\s*[日号]?[^（）()]*[）)]/gu, '')
    .replace(/[（(][^（）()]*\d{4}\s*[年\/.-]\s*\d{1,2}\s*[月\/.-]\s*\d{1,2}\s*[日号]?[^（）()]*[）)]/gu, '')
    .replace(/[（(]\s*(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:,\s*\d{4})?\s*[）)]/giu, '')
    .replace(/\s*[（(]\s*[）)]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function titleDateLabel(value = '', language: Language) {
  const patterns = [
    /[（(][^（）()]*?(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?[^（）()]*?[）)]/u,
    /[（(][^（）()]*?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]?[^（）()]*?[）)]/u,
    /[（(][^（）()]*?(\d{4})\s*[\/.-]\s*(\d{1,2})\s*[\/.-]\s*(\d{1,2})[^（）()]*?[）)]/u,
    /[（(][^（）()]*?(\d{1,2})\s*[\/.-]\s*(\d{1,2})[^（）()]*?[）)]/u,
    /[（(]\s*((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?)\s+(\d{1,2})(?:,\s*(\d{4}))?\s*[）)]/iu
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    if (pattern === patterns[0]) {
      const [, year, month, day] = match;
      return formatDate([Number(year), Number(month), Number(day)], language);
    }

    if (pattern === patterns[1]) {
      const [, month, day] = match;
      const year = new Date().getFullYear();
      return formatDate([year, Number(month), Number(day)], language);
    }

    if (pattern === patterns[2]) {
      const [, year, month, day] = match;
      return formatDate([Number(year), Number(month), Number(day)], language);
    }

    if (pattern === patterns[3]) {
      const [, month, day] = match;
      const year = new Date().getFullYear();
      return formatDate([year, Number(month), Number(day)], language);
    }

    const [, monthName, day, yearValue] = match;
    const normalizedMonthName = monthName.replace('.', '').toLowerCase();
    const month = monthMap[normalizedMonthName];
    const year = yearValue ? Number(yearValue) : new Date().getFullYear();

    if (month) {
      return formatDate([year, month, Number(day)], language);
    }
  }

  return '';
}

function localDateKey(date = new Date(), timeZone?: string | null) {
  if (timeZone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(date);
    const get = (type: string) => parts.find(part => part.type === type)?.value || '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

function dateKeyFromDoodle(doodle: Doodle) {
  const haystack = `${doodle.title} ${doodle.name}`;
  const explicit = haystack.match(new RegExp(`(20\\d{2}).*?(${Object.keys(monthMap).join('|')})[-\\s]+(\\d{1,2})`, 'i')) ||
    haystack.match(new RegExp(`(${Object.keys(monthMap).join('|')})[-\\s]+(\\d{1,2}).*?(20\\d{2})`, 'i'));

  if (explicit) {
    const startsWithYear = explicit[1].startsWith('20');
    const year = Number(startsWithYear ? explicit[1] : explicit[3]);
    const monthName = (startsWithYear ? explicit[2] : explicit[1]).toLowerCase();
    const day = Number(startsWithYear ? explicit[3] : explicit[2]);
    const month = monthMap[monthName];
    if (year && month && day) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const [year, month, day] = doodle.run_date_array;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function shouldCelebrate(doodle?: Doodle, timeZone?: string | null) {
  if (!doodle) return false;
  const text = `${doodle.name} ${doodle.title} ${doodle.localized?.['zh-CN']?.title || ''}`;
  return dateKeyFromDoodle(doodle) === localDateKey(new Date(), timeZone) && importantHolidayPattern.test(text);
}

function festivalName(doodle: Doodle, language: Language) {
  const local = localizedText(doodle, language);
  let title = removeTitleDate(local.title || doodle.title)
    .replace(/Google Doodle/gi, '')
    .replace(/Doodle/gi, '')
    .replace(/[-–—|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (language === 'zh-CN') {
    title = title
      .replace(/快乐$/u, '')
      .replace(/纪念$/u, '')
      .replace(/庆祝/u, '')
      .trim();
    return title || '节日';
  }

  return title
    .replace(/^celebrating\s+/i, '')
    .replace(/^happy\s+/i, '')
    .trim() || 'Holiday';
}

function celebrationMessage(doodle: Doodle, language: Language) {
  const name = festivalName(doodle, language);

  if (language === 'zh-CN') {
    const displayName = name.includes('节') ? name.replace(/节/u, '节\n') : name;
    return `${displayName}快乐`;
  }

  return `Happy ${name}`;
}

function excerpt(doodle: Doodle, language: Language) {
  const local = localizedText(doodle, language);
  const text = removeTitleDate(local.share_text).trim();

  return text || copy[language].fallbackDescription;
}

function imagePlacement(metrics?: CardMetrics) {
  if (!metrics) {
    return {
      '--image-width': 'auto',
      '--image-height': 'auto',
      '--image-max-width': '94%',
      '--image-max-height': '94%'
    };
  }

  const imageRatio = metrics.imageWidth / Math.max(1, metrics.imageHeight);
  const isWide = imageRatio >= 2.8;
  const isPortrait = imageRatio <= 1.25;

  return {
    '--image-width': 'auto',
    '--image-height': 'auto',
    '--image-max-width': isPortrait ? '72%' : '96%',
    '--image-max-height': isWide ? '82%' : '94%'
  };
}


export default function App() {
  const [doodles, setDoodles] = useState<Doodle[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isEngaged, setIsEngaged] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [cardMetrics, setCardMetrics] = useState<Record<string, CardMetrics>>({});
  const [language, setLanguage] = useState<Language>(() => storedLanguage());
  const [visitorTimeZone, setVisitorTimeZone] = useState<string | null>(null);
  const [isMobilePortrait, setIsMobilePortrait] = useState(false);
  const [showCelebration, setShowCelebration] = useState(false);
  const [shareDoodle, setShareDoodle] = useState<Doodle | null>(null);
  const [shareStatus, setShareStatus] = useState('');
  const gesture = useRef({
    active: false,
    start: 0,
    last: 0,
    lastTime: 0,
    velocity: 0,
    vibrationStep: 0
  });
  const wheelLock = useRef(false);
  const wheelAccumulator = useRef(0);
  const wheelResetTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);

  const activeDoodle = doodles[activeIndex];
  const activeText = activeDoodle ? localizedText(activeDoodle, language) : null;
  const rawActiveTitle = activeText?.title || activeDoodle?.title || '';
  const activeTitle = activeDoodle ? removeTitleDate(rawActiveTitle) : '';
  const activeDateLabel = activeDoodle
    ? titleDateLabel(rawActiveTitle, language) || formatDate(activeDoodle.run_date_array, language)
    : '';
  const activeSearchText = activeDoodle
    ? activeTitle || removeTitleDate(activeText?.title || activeDoodle.title)
    : '';
  const activeHue = 28 + (activeIndex * 41) % 210;
  const activePalette = activeDoodle
    ? cardMetrics[activeDoodle.name]?.palette ?? ['#d8b568', '#8fb7dc', '#d98c7b']
    : ['#d8b568', '#8fb7dc', '#d98c7b'];

  const visibleCards = useMemo(() => {
    if (!doodles.length) return [];

    return cardOffsets.map(offset => ({
      doodle: doodles[positiveModulo(activeIndex + offset, doodles.length)],
      offset
    }));
  }, [activeIndex, doodles]);

  const fetchDoodles = () => {
    setLoading(true);
    setError('');

    fetch('/doodles/manifest.json')
      .then(res => {
        if (!res.ok) throw new Error(copy[language].archiveError);
        return res.json();
      })
      .then((data: { doodles?: Doodle[] }) => {
        if (!Array.isArray(data.doodles) || !data.doodles.length) {
          throw new Error(copy[language].archiveError);
        }

        const hashName = decodeURIComponent(window.location.hash.replace(/^#/, ''));
        const hashIndex = hashName ? data.doodles.findIndex(doodle => doodle.name === hashName) : -1;
        setDoodles(data.doodles);
        setActiveIndex(hashIndex >= 0 ? hashIndex : 0);
        setLoading(false);
      })
      .catch(() => fetch('/api/doodle/history')
        .then(res => {
          if (!res.ok) throw new Error(copy[language].archiveError);
          return res.json();
        })
        .then((data: Doodle[]) => {
          const hashName = decodeURIComponent(window.location.hash.replace(/^#/, ''));
          const hashIndex = hashName ? data.findIndex(doodle => doodle.name === hashName) : -1;
          setDoodles(data);
          setActiveIndex(hashIndex >= 0 ? hashIndex : 0);
          setLoading(false);
        })
      )
      .catch(err => {
        setError(err.message);
        setLoading(false);
      })
  };

  useEffect(() => {
    fetchDoodles();
  }, []);

  useEffect(() => {
    window.localStorage.setItem(languageStorageKey, language);
  }, [language]);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/visitor-timezone')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!cancelled) {
          setVisitorTimeZone(typeof data?.timeZone === 'string' ? data.timeZone : null);
        }
      })
      .catch(() => {
        if (!cancelled) setVisitorTimeZone(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px) and (orientation: portrait)');
    const update = () => setIsMobilePortrait(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const firstDoodle = doodles[0];
    if (!firstDoodle || !shouldCelebrate(firstDoodle, visitorTimeZone)) return;

    setShowCelebration(true);
    vibrate([20, 45, 20]);
    const timeout = window.setTimeout(() => setShowCelebration(false), 4600);
    return () => window.clearTimeout(timeout);
  }, [doodles, visitorTimeZone]);

  const canVibrate = () => (
    typeof navigator !== 'undefined' &&
    'vibrate' in navigator &&
    typeof navigator.vibrate === 'function'
  );

  const vibrate = (pattern: number | number[] = 10) => {
    if (canVibrate()) {
      navigator.vibrate(pattern);
    }
  };

  const vibrateByImpulse = (impulse: number) => {
    if (!canVibrate()) return;

    if (impulse > 520) {
      vibrate([18, 18, 24, 24, 32]);
    } else if (impulse > 340) {
      vibrate([14, 18, 22]);
    } else if (impulse > 180) {
      vibrate(16);
    } else {
      vibrate(8);
    }
  };

  const goTo = (direction: number, withPulse = false) => {
    if (!doodles.length) return;
    setActiveIndex(index => positiveModulo(index + direction, doodles.length));
    if (withPulse) vibrate(8);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (shareDoodle) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setShareDoodle(null);
          setShareStatus('');
        }
        return;
      }

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goTo(-1, true);
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        goTo(1, true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [doodles.length, shareDoodle]);

  const handlePageWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (!doodles.length || shareDoodle) return;

    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY;

    if (Math.abs(rawDelta) < 3) return;

    event.preventDefault();

    if (wheelLock.current) return;

    const direction = rawDelta > 0 ? 1 : -1;
    const normalizedDelta = Math.min(64, Math.abs(rawDelta));
    const previousDirection = wheelAccumulator.current >= 0 ? 1 : -1;

    if (previousDirection !== direction) {
      wheelAccumulator.current = 0;
    }

    wheelAccumulator.current += direction * normalizedDelta;

    if (wheelResetTimer.current) {
      window.clearTimeout(wheelResetTimer.current);
    }

    wheelResetTimer.current = window.setTimeout(() => {
      wheelAccumulator.current = 0;
    }, 160);

    if (Math.abs(wheelAccumulator.current) < 96) return;

    wheelLock.current = true;
    wheelAccumulator.current = 0;
    goTo(direction, true);

    window.setTimeout(() => {
      wheelLock.current = false;
    }, 520);
  };

  const spinTo = (direction: number, steps: number) => {
    if (!steps) return;

    let currentStep = 0;
    const tick = () => {
      goTo(direction, false);
      currentStep += 1;
      vibrate(currentStep === 1 ? 14 : 9);

      if (currentStep < steps) {
        window.setTimeout(tick, 70 + currentStep * 58);
      } else {
        vibrate([18, 30, 24]);
      }
    };

    tick();
  };

  const axisValue = (event: PointerEvent<HTMLElement>) => (
    isMobilePortrait ? event.clientY : event.clientX
  );

  const clearLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const stopCardGesture = () => {
    clearLongPress();
    gesture.current.active = false;
    setDragOffset(0);
  };

  const doodleTitle = (doodle: Doodle) => (
    removeTitleDate(localizedText(doodle, language).title || doodle.title) || doodle.title
  );

  const doodleShareUrl = (doodle: Doodle) => {
    const url = new URL(window.location.href);
    url.hash = doodle.name;
    return url.toString();
  };

  const doodleShareText = (doodle: Doodle) => {
    const title = doodleTitle(doodle);
    return {
      title,
      text: `${title} · ${copy[language].appTitle}`,
      url: doodleShareUrl(doodle)
    };
  };

  const copyToClipboard = async (value: string) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  const copyShareLink = async (doodle: Doodle) => {
    const payload = doodleShareText(doodle);
    await copyToClipboard(`${payload.text}\n${payload.url}`);
    setShareStatus(copy[language].copied);
  };

  const openShareSheet = (doodle: Doodle) => {
    setShareDoodle(doodle);
    setShareStatus('');
    setShowCelebration(false);
    vibrate([12, 20, 12]);
  };

  const shareViaSystem = async (doodle: Doodle) => {
    const payload = doodleShareText(doodle);

    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
    } catch {
      return;
    }

    await copyShareLink(doodle);
    setShareStatus(copy[language].shareFallback);
  };

  const openShareChannel = (doodle: Doodle, target: 'weibo' | 'x') => {
    const payload = doodleShareText(doodle);
    const shareUrl = target === 'weibo'
      ? `https://service.weibo.com/share/share.php?title=${encodeURIComponent(payload.text)}&url=${encodeURIComponent(payload.url)}`
      : `https://twitter.com/intent/tweet?text=${encodeURIComponent(payload.text)}&url=${encodeURIComponent(payload.url)}`;

    window.open(shareUrl, '_blank', 'noopener,noreferrer');
  };

  const handlePointerDown = (event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    const value = axisValue(event);
    const now = performance.now();
    setIsEngaged(true);
    clearLongPress();
    longPressTriggered.current = false;
    gesture.current = {
      active: true,
      start: value,
      last: value,
      lastTime: now,
      velocity: 0,
      vibrationStep: 0
    };

    if (activeDoodle) {
      longPressTimer.current = window.setTimeout(() => {
        if (!gesture.current.active) return;
        longPressTriggered.current = true;
        openShareSheet(activeDoodle);
        gesture.current.active = false;
        setIsEngaged(false);
        setDragOffset(0);
      }, 560);
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!gesture.current.active) return;

    const value = axisValue(event);
    const now = performance.now();
    const elapsed = Math.max(12, now - gesture.current.lastTime);
    const delta = value - gesture.current.start;
    if (Math.abs(delta) > 18) clearLongPress();
    gesture.current.velocity = (value - gesture.current.last) / elapsed;
    gesture.current.last = value;
    gesture.current.lastTime = now;
    setDragOffset(0);

    if (isMobilePortrait) {
      const vibrationStep = Math.floor(Math.abs(delta) / 56);
      if (vibrationStep > gesture.current.vibrationStep) {
        gesture.current.vibrationStep = vibrationStep;
        vibrate(9);
      }
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLElement>) => {
    clearLongPress();

    if (longPressTriggered.current) {
      longPressTriggered.current = false;
      return;
    }

    if (!gesture.current.active) return;

    const value = axisValue(event);
    const distance = value - gesture.current.start;
    const velocity = gesture.current.velocity;
    const impulse = Math.abs(distance) + Math.abs(velocity) * (isMobilePortrait ? 420 : 220);
    const threshold = isMobilePortrait ? 42 : 42;

    if (Math.abs(distance) > threshold || Math.abs(velocity) > 0.42) {
      const direction = distance < 0 ? 1 : -1;
      const steps = isMobilePortrait
        ? Math.min(6, Math.max(1, Math.round(impulse / 110)))
        : 1;

      vibrateByImpulse(impulse);
      spinTo(direction, steps);
    } else {
      vibrate(6);
    }

    gesture.current.active = false;
    setDragOffset(0);
  };

  const proxiedImageUrl = (doodle: Doodle) => {
    const [year, month, day] = doodle.run_date_array;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const url = doodle.high_res_url || doodle.url;

    if (url.startsWith('/doodles/')) {
      return url;
    }

    return `/api/doodle/image?url=${encodeURIComponent(url)}&name=${encodeURIComponent(doodle.name)}&date=${encodeURIComponent(date)}`;
  };

  const analyzeDoodleImage = (image: HTMLImageElement): CardMetrics => {
    const width = Math.min(180, image.naturalWidth);
    const height = Math.max(1, Math.round(width / (image.naturalWidth / image.naturalHeight)));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) {
      return {
        color: '#ffffff',
        palette: ['#d8b568', '#8fb7dc', '#d98c7b'],
        imageWidth: 1,
        imageHeight: 1,
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1
      };
    }

    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const edge = 2;
    let red = 0;
    let green = 0;
    let blue = 0;
    let count = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const isEdge = x < edge || y < edge || x >= width - edge || y >= height - edge;
        if (!isEdge) continue;

        const index = (y * width + x) * 4;
        const alpha = pixels[index + 3];
        if (alpha < 24) continue;

        red += pixels[index];
        green += pixels[index + 1];
        blue += pixels[index + 2];
        count += 1;
      }
    }

    const bg = {
      red: count ? Math.round(red / count) : 255,
      green: count ? Math.round(green / count) : 255,
      blue: count ? Math.round(blue / count) : 255
    };
    const buckets = new Map<string, { red: number; green: number; blue: number; count: number; score: number }>();

    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4;
        const alpha = pixels[index + 3];
        if (alpha < 24) continue;

        const pxRed = pixels[index];
        const pxGreen = pixels[index + 1];
        const pxBlue = pixels[index + 2];

        const isNearWhite = pxRed > 232 && pxGreen > 232 && pxBlue > 232;
        if (!isNearWhite) {
          const max = Math.max(pxRed, pxGreen, pxBlue);
          const min = Math.min(pxRed, pxGreen, pxBlue);
          const saturation = max - min;
          const brightness = (pxRed + pxGreen + pxBlue) / 3;
          const isUsefulColor = saturation > 24 && brightness > 30 && brightness < 238;

          if (isUsefulColor) {
            const key = `${Math.round(pxRed / 32) * 32},${Math.round(pxGreen / 32) * 32},${Math.round(pxBlue / 32) * 32}`;
            const existing = buckets.get(key) || { red: 0, green: 0, blue: 0, count: 0, score: 0 };
            existing.red += pxRed;
            existing.green += pxGreen;
            existing.blue += pxBlue;
            existing.count += 1;
            existing.score += 1 + saturation / 64;
            buckets.set(key, existing);
          }
        }

        const distance = Math.abs(pxRed - bg.red) +
          Math.abs(pxGreen - bg.green) +
          Math.abs(pxBlue - bg.blue);

        if (distance < 58) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }

    const hasContent = minX <= maxX && minY <= maxY;
    const rawCropX = hasContent ? minX : 0;
    const rawCropY = hasContent ? minY : 0;
    const rawCropWidth = hasContent ? maxX - minX + 1 : width;
    const rawCropHeight = hasContent ? maxY - minY + 1 : height;
    const margin = Math.max(4, Math.round(rawCropHeight * 0.08));
    const cropX = Math.max(0, rawCropX - margin);
    const cropY = Math.max(0, rawCropY - margin);
    const cropWidth = Math.min(width - cropX, rawCropWidth + margin * 2);
    const cropHeight = Math.min(height - cropY, rawCropHeight + margin * 2);
    const colorDistance = (
      a: { red: number; green: number; blue: number },
      b: { red: number; green: number; blue: number }
    ) => {
      const redDiff = a.red - b.red;
      const greenDiff = a.green - b.green;
      const blueDiff = a.blue - b.blue;
      return Math.sqrt(redDiff * redDiff + greenDiff * greenDiff + blueDiff * blueDiff);
    };

    const colorStats = (red: number, green: number, blue: number) => {
      const max = Math.max(red, green, blue);
      const min = Math.min(red, green, blue);
      const chroma = max - min;
      const brightness = (red + green + blue) / 3;
      let hue = 0;

      if (chroma > 0) {
        if (max === red) {
          hue = ((green - blue) / chroma) % 6;
        } else if (max === green) {
          hue = (blue - red) / chroma + 2;
        } else {
          hue = (red - green) / chroma + 4;
        }
        hue = Math.round(hue * 60);
        if (hue < 0) hue += 360;
      }

      return { hue, chroma, brightness };
    };

    const hueDistance = (a: number, b: number) => {
      const diff = Math.abs(a - b);
      return Math.min(diff, 360 - diff);
    };

    const candidates = Array.from(buckets.values())
      .map(bucket => {
        const red = Math.round(bucket.red / bucket.count);
        const green = Math.round(bucket.green / bucket.count);
        const blue = Math.round(bucket.blue / bucket.count);
        const stats = colorStats(red, green, blue);
        const distanceFromBg = colorDistance({ red, green, blue }, bg);
        const earthyPenalty = stats.chroma < 48 || distanceFromBg < 78 ? 0.35 : 1;

        return {
          red,
          green,
          blue,
          count: bucket.count,
          score: bucket.score * earthyPenalty + stats.chroma * 1.35 + distanceFromBg * 0.85,
          hue: stats.hue,
          chroma: stats.chroma,
          brightness: stats.brightness,
          distanceFromBg
        };
      })
      .filter(color => color.chroma >= 38 && color.brightness > 34 && color.brightness < 232)
      .sort((a, b) => b.score - a.score)
      .slice(0, 28);

    const selectedColors: Array<{
      red: number;
      green: number;
      blue: number;
      score: number;
      hue: number;
      chroma: number;
      brightness: number;
      distanceFromBg: number;
    }> = [];

    for (const candidate of candidates) {
      if (!selectedColors.length) {
        selectedColors.push(candidate);
        continue;
      }

      const nearestRgbDistance = Math.min(...selectedColors.map(color => colorDistance(candidate, color)));
      const nearestHueDistance = Math.min(...selectedColors.map(color => hueDistance(candidate.hue, color.hue)));
      const requiredRgbDistance = selectedColors.length === 1 ? 96 : 76;
      const requiredHueDistance = selectedColors.length === 1 ? 42 : 28;

      if (nearestRgbDistance >= requiredRgbDistance && nearestHueDistance >= requiredHueDistance) {
        selectedColors.push(candidate);
      }

      if (selectedColors.length >= 3) break;
    }

    while (selectedColors.length < 3 && candidates.length) {
      const next = candidates
        .filter(candidate => !selectedColors.includes(candidate))
        .sort((a, b) => {
          const aRgbDistance = selectedColors.length
            ? Math.min(...selectedColors.map(color => colorDistance(a, color)))
            : 0;
          const bRgbDistance = selectedColors.length
            ? Math.min(...selectedColors.map(color => colorDistance(b, color)))
            : 0;
          const aHueDistance = selectedColors.length
            ? Math.min(...selectedColors.map(color => hueDistance(a.hue, color.hue)))
            : 0;
          const bHueDistance = selectedColors.length
            ? Math.min(...selectedColors.map(color => hueDistance(b.hue, color.hue)))
            : 0;

          return (
            bRgbDistance * 0.75 +
            bHueDistance * 1.35 +
            b.chroma * 1.1 +
            b.distanceFromBg * 0.45 +
            b.score * 0.05
          ) - (
            aRgbDistance * 0.75 +
            aHueDistance * 1.35 +
            a.chroma * 1.1 +
            a.distanceFromBg * 0.45 +
            a.score * 0.05
          );
        })[0];

      if (!next) break;
      selectedColors.push(next);
    }

    const palette = selectedColors.map(color => `rgb(${color.red}, ${color.green}, ${color.blue})`);
    const fallbackPalette = [
      `rgb(${Math.max(0, bg.red - 54)}, ${Math.max(0, bg.green - 38)}, ${Math.max(0, bg.blue - 24)})`,
      '#5b8fc7',
      '#d39b3d'
    ];

    return {
      color: `rgb(${bg.red}, ${bg.green}, ${bg.blue})`,
      palette: [
        palette[0] || fallbackPalette[0],
        palette[1] || fallbackPalette[1],
        palette[2] || fallbackPalette[2]
      ],
      imageWidth: width,
      imageHeight: height,
      cropX,
      cropY,
      cropWidth,
      cropHeight
    };
  };

  const rememberCardMetrics = (name: string, image: HTMLImageElement) => {
    if (cardMetrics[name]) return;

    setCardMetrics(metrics => ({
      ...metrics,
      [name]: analyzeDoodleImage(image)
    }));
  };

  return (
    <div
      onWheel={handlePageWheel}
      className="min-h-screen overflow-hidden bg-[#F4F0E8] text-stone-950 selection:bg-stone-950 selection:text-white"
      style={{
        '--accent-hue': activeHue,
        '--bg-color-1': activePalette[0],
        '--bg-color-2': activePalette[1],
        '--bg-color-3': activePalette[2]
      } as CSSProperties}
    >
      <div className="ambient-bg pointer-events-none fixed inset-0" />
      <div className="grain pointer-events-none fixed inset-0 opacity-[0.18]" />

      <div className={showCelebration || shareDoodle ? 'page-blur' : ''}>
      <header className="relative z-10 flex items-center justify-between px-5 py-5 md:px-10 md:py-8">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-normal md:text-4xl">
            {copy[language].appTitle}
          </h1>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.34em] text-stone-500 md:text-xs">
            {copy[language].gallery}
          </p>
        </div>
        <div className="hidden h-px flex-1 bg-stone-300/80 md:mx-10 md:block" />
        <div className="mr-3 flex rounded-full border border-white/70 bg-white/45 p-1.5 shadow-[0_18px_48px_rgba(68,52,35,0.16),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-xl ring-1 ring-stone-900/5 transition duration-300 hover:-translate-y-0.5 hover:bg-white/60 hover:shadow-[0_24px_64px_rgba(68,52,35,0.22),inset_0_1px_0_rgba(255,255,255,0.9)]">
          {(['zh-CN', 'en'] as Language[]).map(option => {
            const isActive = language === option;

            return (
              <button
                key={option}
                type="button"
                aria-label={copy[language].languageLabel}
                onClick={() => setLanguage(option)}
                className={`relative h-9 overflow-hidden rounded-full px-3.5 font-mono text-[10px] uppercase tracking-[0.18em] transition duration-300 ${
                  isActive
                    ? 'text-white'
                    : 'text-stone-500 hover:text-stone-950'
                }`}
              >
                {isActive ? (
                  <motion.span
                    layoutId="language-liquid-pill"
                    className="absolute inset-0 rounded-full bg-stone-950 shadow-[0_10px_26px_rgba(28,25,23,0.34),inset_0_1px_0_rgba(255,255,255,0.2)]"
                    initial={false}
                    animate={{
                      scaleX: [1, 1.32, 0.94, 1.06, 1],
                      scaleY: [1, 0.88, 1.08, 0.98, 1],
                      borderRadius: ['999px', '1.4rem', '999px', '1.2rem', '999px']
                    }}
                    transition={{
                      layout: { type: 'spring', stiffness: 360, damping: 24, mass: 0.85 },
                      scaleX: { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
                      scaleY: { duration: 0.62, ease: [0.22, 1, 0.36, 1] },
                      borderRadius: { duration: 0.62, ease: [0.22, 1, 0.36, 1] }
                    }}
                  />
                ) : null}
                {isActive ? (
                  <motion.span
                    className="absolute inset-[-6px] rounded-full bg-stone-950/20 blur-md"
                    initial={{ opacity: 0, scaleX: 0.72, scaleY: 0.9 }}
                    animate={{ opacity: [0, 0.34, 0], scaleX: [0.72, 1.42, 1.08], scaleY: [0.9, 0.82, 1.04] }}
                    transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
                  />
                ) : null}
                <span className="relative z-10">{option === 'zh-CN' ? '简' : 'EN'}</span>
              </button>
            );
          })}
        </div>
        <a
          href="https://github.com/craftsfool"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Open craftsfool on GitHub"
          className="avatar-link group relative grid h-14 w-14 place-items-center rounded-full border border-white/55 bg-white/35 p-1 shadow-[0_18px_46px_rgba(68,52,35,0.2),inset_0_1px_0_rgba(255,255,255,0.78)] backdrop-blur-xl ring-1 ring-stone-900/5 transition duration-300 ease-out hover:-translate-y-1.5 hover:scale-110 hover:bg-white/50 hover:shadow-[0_28px_72px_rgba(68,52,35,0.28),inset_0_1px_0_rgba(255,255,255,0.92)] focus-visible:-translate-y-1 focus-visible:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900 focus-visible:ring-offset-4 focus-visible:ring-offset-[#F4F0E8] active:scale-105 md:h-16 md:w-16"
        >
          <img
            src="/avatar.jpeg"
            alt="craftsfool avatar"
            className="h-full w-full rounded-full object-cover shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
          />
        </a>
      </header>

      <main className="relative z-10 grid h-[calc(100svh-156px)] items-start gap-3 overflow-hidden px-4 pb-24 pt-1 md:h-[calc(100vh-160px)] md:min-h-0 md:grid-cols-[minmax(330px,0.86fr)_minmax(480px,1.14fr)] md:gap-8 md:overflow-hidden md:px-10 md:pb-10 md:pt-3 lg:px-16">
        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div
              key="loader"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="col-span-full flex flex-col items-center justify-center text-stone-400"
            >
              <Loader2 className="mb-6 h-9 w-9 animate-spin" />
              <p className="font-mono text-xs uppercase tracking-[0.32em]">{copy[language].loading}</p>
            </motion.div>
          ) : error ? (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="col-span-full mx-auto flex max-w-md flex-col items-center border border-red-200 bg-red-50/70 p-8 text-center shadow-[0_24px_70px_rgba(120,53,15,0.10)]"
            >
              <p className="font-serif text-2xl text-red-700">{error}</p>
              <button
                onClick={fetchDoodles}
                className="mt-7 inline-flex h-11 items-center gap-2 rounded-none border border-stone-300 bg-white px-5 font-mono text-xs uppercase tracking-[0.22em] text-stone-800 transition hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0"
              >
                <RefreshCw className="h-4 w-4" />
                {copy[language].retry}
              </button>
            </motion.div>
          ) : activeDoodle ? (
            <>
              <motion.section
                key="copy"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.75, ease: [0.22, 1, 0.36, 1] }}
                className="relative order-2 mx-auto flex h-full w-full max-w-xl min-w-0 flex-col md:order-1 md:max-h-[calc(100vh-205px)] md:overflow-hidden md:pb-20"
              >
                <div className="mb-4 flex items-center gap-3 md:mb-[clamp(1rem,2.2vh,2rem)] md:gap-4">
                  <span className="h-px w-12 bg-stone-400" />
                  <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-stone-500">
                    {String(activeIndex + 1).padStart(2, '0')} / {String(doodles.length).padStart(2, '0')}
                  </span>
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeDoodle.name}
                    initial={{ opacity: 0, y: 18, filter: 'blur(8px)' }}
                    animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                    exit={{ opacity: 0, y: -16, filter: 'blur(8px)' }}
                    transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                    className="scrollbar-hide min-h-0 md:block md:flex-1 md:overflow-y-auto md:pb-8 md:pr-3 md:[mask-image:linear-gradient(to_bottom,black_calc(100%-64px),transparent)]"
                    onWheel={event => event.stopPropagation()}
                  >
                    <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.24em] text-stone-500 md:mb-[clamp(0.75rem,1.6vh,1.25rem)] md:text-[clamp(0.66rem,0.85vw,0.75rem)] md:tracking-[0.28em]">
                      {activeDateLabel}
                    </p>
                    <h2 className="break-words font-display text-[2.05rem] font-medium leading-[1.04] tracking-normal text-stone-950 md:max-w-[11ch] md:text-[clamp(2.6rem,4.4vw,4.6rem)] md:leading-[1.06]">
                      {activeTitle}
                    </h2>
                    <a
                      href={`https://www.bing.com/search?cc=US&setlang=en-US&q=${encodeURIComponent(activeSearchText)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="scrollbar-hide mt-3 block max-h-[calc(100svh-610px)] min-h-[2.8rem] max-w-lg overflow-y-auto break-words font-serif text-[0.95rem] leading-[1.48] text-stone-600 transition [mask-image:linear-gradient(to_bottom,black_calc(100%-22px),transparent)] active:text-stone-950 md:hidden"
                    >
                      {excerpt(activeDoodle, language)}
                    </a>
                    <p className="mt-4 hidden max-w-lg min-h-0 break-words font-serif text-stone-600 md:mt-8 md:block md:text-[clamp(1.05rem,1.55vw,1.5rem)] md:leading-[1.68]">
                      {excerpt(activeDoodle, language)}
                    </p>
                  </motion.div>
                </AnimatePresence>

                <div className="absolute bottom-0 left-0 z-40 hidden items-center gap-3 pt-6 md:flex">
                  <button
                    type="button"
                    onClick={() => goTo(-1)}
                    aria-label={copy[language].previous}
                    className="grid h-12 w-12 place-items-center rounded-full border border-white/70 bg-white/55 text-stone-700 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:bg-white/75 hover:text-stone-950 active:translate-y-0 active:scale-95"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => goTo(1)}
                    aria-label={copy[language].next}
                    className="grid h-12 w-12 place-items-center rounded-full border border-white/70 bg-white/55 text-stone-700 backdrop-blur-xl transition duration-300 hover:-translate-y-0.5 hover:bg-white/75 hover:text-stone-950 active:translate-y-0 active:scale-95"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <a
                    href={`https://www.bing.com/search?cc=US&setlang=en-US&q=${encodeURIComponent(activeSearchText)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-2 inline-flex h-12 items-center gap-2 rounded-full border border-white/55 bg-white/45 px-4 font-mono text-[11px] uppercase tracking-[0.26em] text-stone-500 backdrop-blur-xl transition hover:-translate-y-0.5 hover:bg-white/65 hover:text-stone-950 active:translate-y-0 active:scale-95"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {copy[language].explore}
                  </a>
                </div>
              </motion.section>

              <motion.section
                key="cards"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                className="order-1 mt-6 mx-auto flex w-full max-w-3xl touch-none select-none items-start justify-center md:fixed md:left-[clamp(410px,44vw,700px)] md:right-10 md:top-1/2 md:z-20 md:mx-0 md:mt-0 md:h-[clamp(260px,36vw,520px)] md:w-auto md:max-w-none md:-translate-y-1/2 md:items-center lg:right-16"
                onMouseEnter={() => setIsEngaged(true)}
                onMouseLeave={() => {
                  setIsEngaged(false);
                  stopCardGesture();
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={() => {
                  stopCardGesture();
                }}
              >
                <div className="relative h-[clamp(210px,31svh,330px)] w-full min-w-0 max-w-[760px] [perspective:1200px] portrait:h-[clamp(205px,30svh,320px)] md:h-full md:max-w-none md:[perspective:1500px]">
                  <div className="absolute left-1/2 top-[43%] h-[70%] w-[80%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[hsl(var(--accent-hue)_62%_60%/0.16)] blur-3xl transition-colors duration-700 md:top-1/2" />

                  {visibleCards.map(({ doodle, offset }) => {
                    const abs = Math.abs(offset);
                    const isActive = offset === 0;
                    const imageUrl = proxiedImageUrl(doodle);
                    const metrics = cardMetrics[doodle.name];
                    const cardColor = metrics?.color ?? '#ffffff';

                    return (
                      <motion.article
                        key={doodle.name}
                        className="doodle-min-card absolute left-1/2 top-[43%] grid -translate-x-1/2 -translate-y-1/2 place-items-center overflow-hidden rounded-[2.15rem] border border-white/80 bg-white/42 p-4 shadow-[0_24px_70px_rgba(50,38,28,0.2),inset_0_1px_0_rgba(255,255,255,0.9),inset_0_0_34px_rgba(255,255,255,0.42)] backdrop-blur-xl md:top-1/2 md:rounded-[2.6rem] md:p-6 md:shadow-[0_34px_96px_rgba(50,38,28,0.24),inset_0_1px_0_rgba(255,255,255,0.94),inset_0_0_48px_rgba(255,255,255,0.46)]"
                        animate={{
                          x: isActive ? 0 : (isMobilePortrait ? 0 : offset * 36),
                          y: isActive ? 0 : (isMobilePortrait ? offset * 42 : offset * 8),
                          rotate: isActive ? 0 : offset * (isMobilePortrait ? 1.6 : 3.2),
                          rotateY: isActive ? 0 : offset * (isMobilePortrait ? 0 : -9),
                          rotateX: isActive ? 0 : offset * (isMobilePortrait ? 4 : 1.5),
                          scale: isActive ? 1 : 1 - abs * (isMobilePortrait ? 0.07 : 0.045),
                          opacity: isActive ? 1 : abs > 1 ? 0.18 : 0.5,
                          filter: isActive ? 'blur(0px)' : abs > 1 ? 'blur(1.8px)' : 'blur(0.4px)'
                        }}
                        transition={{ type: 'spring', stiffness: 330, damping: 28, mass: 0.82 }}
                        style={{
                          '--edge-bg': cardColor,
                          ...imagePlacement(metrics),
                          zIndex: 10 - abs,
                          pointerEvents: isActive ? 'auto' : 'none',
                          transformStyle: 'preserve-3d'
                        } as CSSProperties}
                      >
                        <div className="doodle-crop">
                          <img
                            src={imageUrl}
                            alt={doodle.title}
                            draggable={false}
                            onLoad={event => rememberCardMetrics(doodle.name, event.currentTarget)}
                            className="doodle-image"
                          />
                        </div>
                      </motion.article>
                    );
                  })}
                </div>
              </motion.section>
            </>
          ) : null}
        </AnimatePresence>
      </main>

      <footer className="fixed bottom-3 left-0 right-0 z-10 px-6 text-center font-mono text-[9px] uppercase tracking-[0.26em] text-stone-400 md:relative md:bottom-auto md:left-auto md:right-auto md:px-6 md:pb-7 md:text-[10px] md:tracking-[0.32em]">
        {copy[language].footer}
      </footer>
      </div>

      <AnimatePresence>
        {showCelebration && doodles[0] ? (
          <motion.div
            className="celebration-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCelebration(false)}
          >
            <div className="firework firework-a" />
            <div className="firework firework-b" />
            <div className="firework firework-c" />
            {Array.from({ length: 30 }).map((_, index) => (
              <span
                key={index}
                className="confetti"
                style={{
                  '--i': index,
                  '--x': `${(index * 37) % 100}%`,
                  '--drift': `${((index % 9) - 4) * 18}px`
                } as CSSProperties}
              />
            ))}
            <motion.div
              className="celebration-caption"
              initial={{ opacity: 0, y: 28, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.25, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <h2 className="whitespace-pre-line">{celebrationMessage(doodles[0], language)}</h2>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {shareDoodle ? (() => {
          const title = doodleTitle(shareDoodle);
          const imageUrl = proxiedImageUrl(shareDoodle);
          const metrics = cardMetrics[shareDoodle.name];

          return (
            <motion.div
              key="share-overlay"
              className="share-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setShareDoodle(null);
                setShareStatus('');
              }}
              onWheel={event => event.stopPropagation()}
            >
              <motion.div
                className="share-dialog"
                role="dialog"
                aria-modal="true"
                aria-label={copy[language].share}
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 18, scale: 0.97 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                onClick={event => event.stopPropagation()}
              >
                <button
                  type="button"
                  aria-label={copy[language].closeShare}
                  onClick={() => {
                    setShareDoodle(null);
                    setShareStatus('');
                  }}
                  className="share-close"
                >
                  <X className="h-4 w-4" />
                </button>

                <div
                  className="share-preview-card"
                  style={{
                    '--edge-bg': metrics?.color ?? '#ffffff',
                    ...imagePlacement(metrics)
                  } as CSSProperties}
                >
                  <div className="share-preview-frame">
                    <div className="doodle-crop share-preview-crop">
                      <img
                        src={imageUrl}
                        alt={title}
                        draggable={false}
                        className="doodle-image"
                      />
                    </div>
                  </div>
                  <h2>{title}</h2>
                </div>

                <p className="share-channel-title">{copy[language].shareWith}</p>
                <div className="share-actions">
                  <button type="button" onClick={() => shareViaSystem(shareDoodle)} className="share-action">
                    <Share2 className="h-4 w-4" />
                    <span>{copy[language].systemShare}</span>
                  </button>
                  <button type="button" onClick={() => copyShareLink(shareDoodle)} className="share-action">
                    <Copy className="h-4 w-4" />
                    <span>{copy[language].copyLink}</span>
                  </button>
                  <button type="button" onClick={() => openShareChannel(shareDoodle, 'weibo')} className="share-action">
                    <ExternalLink className="h-4 w-4" />
                    <span>{copy[language].weibo}</span>
                  </button>
                  <button type="button" onClick={() => openShareChannel(shareDoodle, 'x')} className="share-action">
                    <ExternalLink className="h-4 w-4" />
                    <span>X</span>
                  </button>
                </div>
                {shareStatus ? <p className="share-status">{shareStatus}</p> : null}
              </motion.div>
            </motion.div>
          );
        })() : null}
      </AnimatePresence>
    </div>
  );
}
