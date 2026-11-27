import localRegions from './data-mirror/region-map.json';
import localFashion from './data-mirror/fashion-images.json';
import localWeatherMap from './data-mirror/weather-clothing-map.json';
import localPresets from './data-mirror/region-presets.json';
import topImageMap from './data-mirror/top-image-map.json';
import { resolveRegionFromReverseAddress, latLonToKmaGrid } from './location-resolution.js';
import { supabase } from './supabase';

const OUTERWEAR = /(코트|패딩|자켓|재킷|야상|무스탕|점퍼|바람막이|트렌치|아우터|목도리|장갑|블레이저)/i;
const NOT_TOP = /(바지|팬츠|데님|청바지|슬랙스|스커트|치마|부츠|신발|스니커즈|로퍼|샌들|구두|양말|가방|벨트|반바지|레깅스)/i;
const TOP = /(맨투맨|니트|터틀넥|목폴라|히트텍|셔츠|블라우스|티셔츠|스웨터|가디건|후드|베스트|조끼|반팔|긴팔|민소매|폴로|상의|탑|풀오버|플리스|크루넥)/i;

export function makeSessionId() {
  try { return `demo-${crypto.randomUUID()}`; }
  catch { return `demo-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}
export function getSessionId() {
  let id = localStorage.getItem('wearther_session_id');
  if (!id) { id = makeSessionId(); localStorage.setItem('wearther_session_id', id); }
  return id;
}

function clean(value) {
  if (value == null || value === 'nan' || value === 'NaN') return '';
  return String(value).trim();
}
function regionLabel(row) { return [clean(row.sido), clean(row.sigungu), clean(row.dong)].filter(Boolean).join(' '); }
function normalizeRegion(row) {
  return {
    ...row,
    id: row.id ?? `${clean(row.sido)}-${clean(row.sigungu)}-${clean(row.dong)}`,
    sido: clean(row.sido), sigungu: clean(row.sigungu), dong: clean(row.dong),
    zone: clean(row.zone), nx: Number(row.nx), ny: Number(row.ny),
    label: clean(row.label) || regionLabel(row),
  };
}
function normalizeRows(rows) { return (rows || []).map((row) => ({ ...row, ...normalizeRegion(row) })); }
function isPexels(url = '') { return /^https:\/\/images\.pexels\.com\//i.test(url); }
function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') { try { const out = JSON.parse(value); return Array.isArray(out) ? out : []; } catch { return []; } }
  return [];
}
function normalizedFashion(row) { return { ...row, clothing_items: parseArray(row.clothing_items) }; }

function addAggregateOptions(rows, query) {
  if (!rows.length) return [];
  const q = query.trim().replace(/\s+/g, ' ');
  const exactCityGroups = new Map();
  for (const raw of rows) {
    const r = normalizeRegion(raw);
    if (!r.sido || !r.sigungu) continue;
    const key = `${r.sido}|${r.sigungu}`;
    if (!exactCityGroups.has(key)) exactCityGroups.set(key, r);
  }
  const aggregates = [];
  for (const r of exactCityGroups.values()) {
    if (r.sigungu === q || regionLabel(r) === q || `${r.sido} ${r.sigungu}`.includes(q)) {
      aggregates.push({ ...r, id: `aggregate-${r.sido}-${r.sigungu}`, dong: '', label: `${r.sido}, ${r.sigungu} 전체`, isAggregate: true });
    }
  }
  // 도/광역시 검색은 행정구역 안의 첫 번째 격자 좌표를 대표값으로 사용합니다.
  const province = rows.map(normalizeRegion).find((r) => r.sido === q || r.sido.replace(/특별자치도|특별시|광역시|자치도|도/g, '') === q);
  if (province) {
    const found = { ...province, id: `aggregate-${province.sido}`, sigungu: '', dong: '', label: `${province.sido} 전체`, isAggregate: true };
    aggregates.unshift(found);
  }
  const seen = new Set(aggregates.map((r) => r.id));
  const aggregateGroups = new Set(aggregates.filter((r) => r.sigungu).map((r) => `${r.sido}|${r.sigungu}`));
  const details = rows.map(normalizeRegion).filter((r) => {
    if (seen.has(r.id)) return false;
    if (!r.dong && aggregateGroups.has(`${r.sido}|${r.sigungu}`)) return false;
    return true;
  }).map((r) => ({ ...r, label: regionLabel(r) }));
  return [...aggregates, ...details];
}

function localSearchRegions(query) {
  const q = query.trim().replace(/\s+/g, ' ');
  if (!q) return [];
  const qNoSpace = q.replace(/\s/g, '');
  const rows = localRegions.filter((raw) => {
    const r = normalizeRegion(raw);
    const label = regionLabel(r);
    const compact = label.replace(/\s/g, '');
    const parts = q.split(' ').filter(Boolean);
    const tokenMatch = parts.length > 1 && parts.every((part) => r.sido.includes(part) || r.sigungu.includes(part) || r.dong.includes(part));
    return label.includes(q) || compact.includes(qNoSpace) || tokenMatch
      || r.sido.includes(q) || r.sigungu.includes(q) || r.dong.includes(q)
      || (q.endsWith('동') && r.dong.replace(/[0-9]+동$/, '동') === q)
      || (q.endsWith('동') && r.dong.startsWith(q.replace(/동$/, '')));
  });
  return rows.sort((a, b) => {
    const aa = normalizeRegion(a), bb = normalizeRegion(b);
    const aExact = regionLabel(aa) === q || aa.dong === q || aa.sigungu === q ? 0 : 1;
    const bExact = regionLabel(bb) === q || bb.dong === q || bb.sigungu === q ? 0 : 1;
    return aExact - bExact || regionLabel(aa).length - regionLabel(bb).length;
  }).slice(0, 45);
}

export async function searchRegions(query) {
  const q = query.trim();
  if (!q) return [];
  if (supabase) {
    const { data, error } = await supabase.rpc('search_regions', { p_query: q, p_limit: 45 });
    if (!error && Array.isArray(data) && data.length) {
      const normalized = data.map(normalizeRegion);
      return addAggregateOptions(normalized, q).slice(0, 45);
    }
    if (error) console.warn('search_regions RPC 사용 실패 — 업로드된 region_map 데이터로 검색합니다.', error.message);
  }
  // 로컬 미러에는 업로드된 region_map 18,626행이 들어 있습니다.
  const rows = localSearchRegions(q);
  // preset 별칭(홍대, 성수 등)은 region_map에서 찾은 좌표를 사용합니다.
  const preset = localPresets.find((p) => clean(p.key).toLowerCase() === q.toLowerCase() || clean(p.label).toLowerCase() === q.toLowerCase());
  if (preset && !rows.some((r) => r.zone === preset.zone)) {
    const candidate = localRegions.find((r) => clean(r.sido).includes(clean(preset.sido)) && clean(r.sigungu).includes(clean(preset.sigungu)) && (!preset.dong || clean(r.dong).includes(clean(preset.dong))));
    if (candidate) rows.unshift({ ...candidate, label: `${preset.label} · ${regionLabel(candidate)}` });
  }
  return addAggregateOptions(rows, q).slice(0, 45);
}

export async function findCurrentLocationRegion() {
  if (!navigator.geolocation) throw new Error('이 브라우저에서는 현위치 기능을 사용할 수 없습니다.');

  // 현위치 버튼을 누를 때마다 새 위치를 요청합니다. 이전 5분 위치 캐시를
  // 재사용하지 않고, 브라우저가 가능한 높은 정확도의 좌표를 제공하도록 합니다.
  const position = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    enableHighAccuracy: true,
    timeout: 25000,
    maximumAge: 0,
  }));
  const { latitude, longitude, accuracy } = position.coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('현재 위치 좌표를 확인하지 못했습니다. 지역을 직접 검색해주세요.');
  }

  const reverseUrl = new URL('https://nominatim.openstreetmap.org/reverse');
  reverseUrl.search = new URLSearchParams({
    format: 'jsonv2',
    lat: String(latitude),
    lon: String(longitude),
    zoom: '18',
    addressdetails: '1',
    'accept-language': 'ko',
  }).toString();

  const reverse = await fetch(reverseUrl, { headers: { Accept: 'application/json' } });
  if (!reverse.ok) throw new Error('현위치 주소를 확인하지 못했습니다. 지역을 직접 검색해주세요.');
  const json = await reverse.json();
  const matched = resolveRegionFromReverseAddress(json.address || {}, localRegions);

  if (!matched) {
    throw new Error('현재 위치의 시·군·구·동을 지역 데이터에서 정확히 찾지 못했습니다. 다른 지역을 임의로 선택하지 않았으니 지역을 직접 검색해주세요.');
  }

  // region_map은 권역(zone)과 행정구역 확인에 사용합니다. KMA nx/ny는
  // 역지오코딩 주소의 대표 격자가 아니라 실제 GPS 좌표로 계산해 더 정확히 조회합니다.
  const gpsGrid = latLonToKmaGrid(latitude, longitude);

  // 로컬 데이터 미러로 행정구역/권역을 확인한 뒤, Supabase가 연결되어
  // 있으면 동일한 키(sido/sigungu/dong)의 실제 DB 행을 조회합니다.
  if (supabase) {
    try {
      let query = supabase.from('region_map')
        .select('id,sido,sigungu,dong,zone,nx,ny')
        .eq('sido', matched.sido)
        .eq('sigungu', matched.sigungu);
      query = query.eq('dong', matched.dong || '');
      const { data, error } = await query.limit(1).maybeSingle();
      if (!error && data) {
        return normalizeRegion({
          ...matched,
          ...data,
          // Supabase 행의 행정구역 대표 격자보다 현재 GPS 좌표의 격자를 우선합니다.
          ...gpsGrid,
          id: matched.isAggregate ? matched.id : data.id,
          isAggregate: Boolean(matched.isAggregate),
          displayDong: matched.displayDong || '',
          label: matched.label || regionLabel(data),
          locationAccuracyMeters: Number.isFinite(accuracy) ? Math.round(accuracy) : null,
        });
      }
      if (error) console.warn('현위치 매칭 행의 Supabase 재조회 실패 — region_map 미러 데이터를 사용합니다.', error.message);
    } catch (error) {
      console.warn('현위치 매칭 행의 Supabase 재조회 중 오류 — region_map 미러 데이터를 사용합니다.', error?.message || error);
    }
  }

  const result = normalizeRegion({ ...matched, ...gpsGrid });
  if (!result.label) result.label = regionLabel(result);
  // 위치 정확도는 진단/표시가 필요할 때 활용할 수 있도록 메타데이터로만 보존합니다.
  result.locationAccuracyMeters = Number.isFinite(accuracy) ? Math.round(accuracy) : null;
  return result;
}

function demoWeather() {
  const now = new Date();
  const temp = 7;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sampleDays = [
    [10, 3, 'cloud', '구름 조금'], [9, 2, 'sun', '맑음'], [8, 1, 'sun', '맑음'],
    [7, 2, 'rain', '비'], [6, 1, 'overcast', '흐림'], [8, 2, 'cloud', '구름 조금'], [11, 4, 'sun', '맑음'],
  ].map(([max, min, code, text], index) => {
    const date = new Date(today); date.setDate(today.getDate() + index);
    const ymd = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
    return { date: ymd, max, min, code, text, available: true };
  });
  return {
    temp, min: 3, max: 10, condition: '구름 조금', conditionCode: 'cloud', precipitation: 10, humidity: 48, wind: 1.8,
    hourly: [
      { time: '09:00', temp: 4, pop: 10, sky: { code: 'sun', text: '맑음' } },
      { time: '12:00', temp: 8, pop: 10, sky: { code: 'sun', text: '맑음' } },
      { time: '15:00', temp: 10, pop: 10, sky: { code: 'cloud', text: '구름 조금' } },
      { time: '18:00', temp: 6, pop: 10, sky: { code: 'cloud', text: '구름 조금' } },
      { time: '21:00', temp: 4, pop: 10, sky: { code: 'night', text: '맑은 밤' } },
    ],
    daily: sampleDays,
    source: '시연용 샘플 날씨', demo: true, updatedAt: now.toISOString(),
  };
}
export async function fetchWeather(region) {
  try {
    const response = await fetch(`/api/weather?nx=${encodeURIComponent(region.nx)}&ny=${encodeURIComponent(region.ny)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '날씨 정보를 불러오지 못했습니다.');
    return { ...data, demo: false };
  } catch (error) {
    if (String(error.message || '').includes('KMA_SERVICE_KEY가 설정되지')) return demoWeather();
    return { ...demoWeather(), warning: error.message || '기상청 연결 실패' };
  }
}

export async function loadFashionRows(zone) {
  if (supabase) {
    const { data, error } = await supabase.from('fashion_images')
      .select('id,image_url,keyword,temp_range,clothing_items,description,zone,region')
      .eq('zone', zone).not('image_url', 'is', null).limit(1000);
    if (!error && Array.isArray(data) && data.length) return data.map(normalizedFashion).filter((r) => isPexels(r.image_url));
    if (error) console.warn('fashion_images 조회 실패 — CSV 미러로 대체합니다.', error.message);
  }
  return localFashion.filter((row) => clean(row.zone) === zone && isPexels(row.image_url)).map(normalizedFashion);
}
export async function loadWeatherClothingMap() {
  if (supabase) {
    const { data, error } = await supabase.from('weather_clothing_map')
      .select('id,temp_min,temp_max,temp_range_label,weather_keyword,style_keyword,clothing_items,description')
      .order('temp_min', { ascending: false });
    if (!error && data?.length) return data.map((r) => ({ ...r, style_keyword: parseArray(r.style_keyword), clothing_items: parseArray(r.clothing_items) }));
    if (error) console.warn('weather_clothing_map 조회 실패 — CSV 미러로 대체합니다.', error.message);
  }
  return localWeatherMap.map((r) => ({ ...r, style_keyword: parseArray(r.style_keyword), clothing_items: parseArray(r.clothing_items) }));
}
export async function loadRegionOffset(zone) {
  if (!supabase) return 0;
  const { data, error } = await supabase.from('region_adjust').select('temp_offset').eq('zone', zone).maybeSingle();
  if (error) { console.warn('지역별 기온 보정치 조회 실패', error.message); return 0; }
  return Number(data?.temp_offset) || 0;
}
export function findTempRange(temp, mapping) {
  const rows = [...mapping].sort((a, b) => (Number(a.temp_max) - Number(a.temp_min)) - (Number(b.temp_max) - Number(b.temp_min)));
  return rows.find((row) => temp >= Number(row.temp_min) && temp <= Number(row.temp_max))
    || [...rows].sort((a, b) => Math.abs((Number(a.temp_min) + Number(a.temp_max)) / 2 - temp) - Math.abs((Number(b.temp_min) + Number(b.temp_max)) / 2 - temp))[0];
}
function extractTops(row) {
  const entries = row.clothing_items.map((value) => String(value).trim()).filter((value) => TOP.test(value) && !OUTERWEAR.test(value) && !NOT_TOP.test(value));
  return [...new Set(entries)];
}
function feedbackBonus(row, feedbacks) {
  return feedbacks.filter((feedback) => feedback.outfit_image === row.image_url)
    .reduce((score, item) => score + (item.feedback === 'good' ? 0.08 : -0.05), 0);
}
function getRowsForBand(rows, bandLabel, temp) {
  const exact = rows.filter((row) => row.temp_range === bandLabel);
  if (exact.length) return { rows: exact, exact: true };
  const bands = [...new Set(rows.map((row) => row.temp_range).filter(Boolean))];
  const center = (label) => {
    const nums = label.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
    return nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0] ?? 0;
  };
  const selectedBand = bands.sort((a, b) => Math.abs(center(a) - temp) - Math.abs(center(b) - temp))[0];
  return { rows: selectedBand ? rows.filter((row) => row.temp_range === selectedBand) : rows, exact: false };
}
export function buildRecommendations({ rows, band, effectiveTemp, feedbacks = [] }) {
  // Top 4는 선택 지역의 zone + 가장 가까운 기온대의 fashion_images 행만 사용합니다.
  const selection = getRowsForBand(rows, band.temp_range_label, effectiveTemp);
  const bandRows = selection.rows;
  if (!bandRows.length) return { outfit: null, top4: [], selectedRange: band.temp_range_label, sampleSize: 0 };
  const frequency = new Map();
  bandRows.forEach((row) => extractTops(row).forEach((top) => frequency.set(top, (frequency.get(top) || 0) + 1)));
  const maxFrequency = Math.max(1, ...frequency.values());
  const rankedOutfits = bandRows.map((row) => {
    const popularity = extractTops(row).reduce((n, top) => n + (frequency.get(top) || 0), 0) / Math.max(1, extractTops(row).length) / maxFrequency;
    const feedback = Math.max(-1, Math.min(1, feedbackBonus(row, feedbacks) / 0.4));
    const weatherMatch = selection.exact ? 1 : Math.max(0.35, 1 - Math.abs(effectiveTemp - bandMid(row.temp_range)) / 18);
    const score = 0.45 + weatherMatch * 0.30 + popularity * 0.20 + feedback * 0.05;
    return { ...row, score: Math.max(0.1, Math.min(1, score)), scoreParts: { zone: 0.45, weather: weatherMatch * 0.30, popularity: popularity * 0.20, feedback: feedback * 0.05 } };
  }).sort((a, b) => b.score - a.score || Number(a.id) - Number(b.id));
  const outfit = rankedOutfits[0];
  const byTop = new Map();
  for (const row of bandRows) {
    for (const top of extractTops(row)) {
      const current = byTop.get(top) || { item: top, count: 0, image: row.image_url, row };
      current.count += 1;
      if (Number(row.id) < Number(current.row.id)) { current.image = row.image_url; current.row = row; }
      byTop.set(top, current);
    }
  }
  const top4 = [...byTop.values()].sort((a, b) => b.count - a.count || a.item.localeCompare(b.item, 'ko')).slice(0, 4).map((item, index) => {
    const curated = topImageMap[item.item];
    return {
      ...item,
      image: curated?.image_url || item.image,
      imageAlt: curated?.alt || `${item.item} 착용 사진`,
      imageSource: curated?.source_page || null,
      fallbackImage: item.image,
      rank: index + 1,
    };
  });
  return { outfit, top4, selectedRange: bandRows[0]?.temp_range || band.temp_range_label, sampleSize: bandRows.length };
}
function bandMid(label = '') {
  const nums = label.match(/-?\d+(?:\.\d+)?/g)?.map(Number) || [];
  return nums.length >= 2 ? (nums[0] + nums[1]) / 2 : nums[0] ?? 0;
}
export async function loadFeedback(sessionId) {
  if (supabase) {
    const { data, error } = await supabase.from('outfit_feedback')
      .select('id,session_id,region,zone,temp,temp_range,outfit_image,outfit_title,feedback,comment,created_at')
      .eq('session_id', sessionId).order('created_at', { ascending: false });
    if (!error && Array.isArray(data)) return data;
    if (error) console.warn('outfit_feedback 조회 실패 — 브라우저 리뷰를 표시합니다.', error.message);
  }
  try { return JSON.parse(localStorage.getItem('wearther_reviews') || '[]'); } catch { return []; }
}
export async function saveFeedback(payload) {
  const localRecord = { id: `local-${Date.now()}`, ...payload, created_at: new Date().toISOString() };
  if (supabase) {
    const { data, error } = await supabase.rpc('submit_outfit_feedback', {
      p_feedback: payload.feedback, p_region: payload.region, p_temp: payload.temp,
      p_outfit_image: payload.outfit_image, p_outfit_title: payload.outfit_title,
      p_comment: payload.comment || null, p_session_id: payload.session_id,
    });
    if (!error) return { ...localRecord, id: data?.id ?? localRecord.id, persisted: true };
    console.warn('submit_outfit_feedback RPC 실패 — 로컬 저장을 시도합니다.', error.message);
    const { error: insertError } = await supabase.from('outfit_feedback').insert({
      session_id: payload.session_id, region: payload.region, zone: payload.zone, temp: payload.temp,
      temp_range: payload.temp_range, outfit_image: payload.outfit_image, outfit_title: payload.outfit_title,
      feedback: payload.feedback, comment: payload.comment || null,
    });
    if (!insertError) return { ...localRecord, persisted: true };
  }
  const existing = await loadFeedback(payload.session_id);
  localStorage.setItem('wearther_reviews', JSON.stringify([localRecord, ...existing]));
  return { ...localRecord, persisted: false };
}
export async function getFeedbackTempOffset(sessionId) {
  if (!supabase) return 0;
  const { data, error } = await supabase.rpc('get_session_temp_offset', { p_session_id: sessionId });
  if (error) { console.warn('피드백 온도 보정 RPC 실패', error.message); return 0; }
  return Number(data) || 0;
}
export function weatherIconCode(weather) {
  const code = weather?.conditionCode || 'cloud';
  return ['rain', 'sleet', 'snow', 'sun', 'cloud', 'overcast'].includes(code) ? code : 'cloud';
}
export function regionDisplay(region) {
  if (!region) return '지역을 설정해주세요';
  return region.label || [region.sido, region.sigungu, region.dong].filter(Boolean).join(' ');
}
