const BASE_URL = 'https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0';

function kstParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
}

function shiftKst(parts, minutes) {
  // UTC arithmetic over KST components avoids server timezone assumptions.
  const d = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute + minutes));
  return {
    year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1).padStart(2, '0'),
    day: String(d.getUTCDate()).padStart(2, '0'), hour: String(d.getUTCHours()).padStart(2, '0'),
    minute: String(d.getUTCMinutes()).padStart(2, '0'),
  };
}

function latestBase(minutesBefore, hours) {
  const shifted = shiftKst(kstParts(), -minutesBefore);
  const hour = Number(shifted.hour);
  const selected = [...hours].reverse().find((h) => h <= hour);
  if (selected !== undefined) {
    return { base_date: `${shifted.year}${shifted.month}${shifted.day}`, base_time: `${String(selected).padStart(2, '0')}00` };
  }
  const previous = shiftKst({ ...shifted, hour: '00', minute: '00' }, -1);
  return { base_date: `${previous.year}${previous.month}${previous.day}`, base_time: `${String(hours[hours.length - 1]).padStart(2, '0')}00` };
}

function asItems(payload) {
  const items = payload?.response?.body?.items?.item;
  if (!items) return [];
  return Array.isArray(items) ? items : [items];
}

async function callKma(operation, params, key) {
  const url = new URL(`${BASE_URL}/${operation}`);
  const all = { serviceKey: key, pageNo: '1', numOfRows: '1000', dataType: 'JSON', ...params };
  Object.entries(all).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); }
  catch { throw new Error(`기상청 응답을 JSON으로 읽지 못했습니다. HTTP ${response.status}: ${text.slice(0, 180)}`); }
  if (!response.ok) throw new Error(`기상청 API HTTP ${response.status}`);
  const header = payload?.response?.header;
  if (header?.resultCode && header.resultCode !== '00') {
    throw new Error(`기상청 API 오류 ${header.resultCode}: ${header.resultMsg || '요청 실패'}`);
  }
  return asItems(payload);
}

function category(items, code) {
  return items.find((item) => item.category === code)?.obsrValue ?? null;
}

function formatFcst(items) {
  const map = new Map();
  for (const item of items) {
    const key = `${item.fcstDate}${item.fcstTime}`;
    if (!map.has(key)) map.set(key, { date: item.fcstDate, time: item.fcstTime });
    map.get(key)[item.category] = item.fcstValue;
  }
  return [...map.values()].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
}

function conditionOf(row) {
  const pty = Number(row?.PTY ?? 0);
  if (pty === 1 || pty === 4) return { text: '비', code: 'rain' };
  if (pty === 2) return { text: '비 또는 눈', code: 'sleet' };
  if (pty === 3) return { text: '눈', code: 'snow' };
  const sky = Number(row?.SKY ?? 1);
  if (sky === 3) return { text: '구름 많음', code: 'cloud' };
  if (sky === 4) return { text: '흐림', code: 'overcast' };
  return { text: '맑음', code: 'sun' };
}

export function createWeatherHandler() {
  return async function weatherHandler(req, res) {
    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'GET 요청만 허용됩니다.' }));
      return;
    }
    const url = new URL(req.url, 'http://localhost');
    const nx = Number(url.searchParams.get('nx'));
    const ny = Number(url.searchParams.get('ny'));
    if (!Number.isInteger(nx) || !Number.isInteger(ny)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'nx, ny 격자 좌표가 필요합니다.' }));
      return;
    }
    const key = process.env.KMA_SERVICE_KEY;
    if (!key) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'KMA_SERVICE_KEY가 설정되지 않았습니다.' }));
      return;
    }
    try {
      const villageBase = latestBase(20, [2, 5, 8, 11, 14, 17, 20, 23]);
      const nowBase = latestBase(15, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]);
      const [nowItems, villageItems] = await Promise.all([
        callKma('getUltraSrtNcst', { ...nowBase, nx, ny }, key),
        callKma('getVilageFcst', { ...villageBase, nx, ny }, key),
      ]);
      const forecast = formatFcst(villageItems);
      const kst = kstParts();
      const today = `${kst.year}${kst.month}${kst.day}`;
      const todayForecast = forecast.filter((row) => row.date === today);
      const currentRaw = category(nowItems, 'T1H');
      const currentNowcast = currentRaw == null ? Number.NaN : Number(currentRaw);
      const fallbackTempRow = todayForecast.find((row) => row.TMP != null);
      const currentTemp = Number.isFinite(currentNowcast) ? currentNowcast : Number(fallbackTempRow?.TMP);
      if (!Number.isFinite(currentTemp)) throw new Error('현재 기온 자료가 없습니다. 잠시 후 다시 시도해주세요.');
      const validTemps = todayForecast.map((row) => Number(row.TMP)).filter(Number.isFinite);
      const nowMinutes = Number(kst.hour) * 60 + Number(kst.minute);
      const nearest = [...todayForecast].filter((row) => row.TMP != null).sort((a, b) => {
        const toMinutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(2, 4));
        return Math.abs(toMinutes(a.time) - nowMinutes) - Math.abs(toMinutes(b.time) - nowMinutes);
      })[0] || fallbackTempRow || {};
      const condition = conditionOf(nearest);
      const popValues = todayForecast.map((row) => Number(row.POP)).filter(Number.isFinite);
      const rehRaw = category(nowItems, 'REH');
      const windRaw = category(nowItems, 'WSD');
      const reh = rehRaw == null ? Number.NaN : Number(rehRaw);
      const wsd = windRaw == null ? Number.NaN : Number(windRaw);
      // 시간대별 카드는 오늘 날짜의 남은 예보만 보여줍니다.
      const upcomingForecast = todayForecast.filter((row) => {
        const rowMinutes = Number(String(row.time || '0000').slice(0, 2)) * 60 + Number(String(row.time || '0000').slice(2, 4));
        return rowMinutes > nowMinutes;
      });
      const currentCondition = { ...condition };
      const currentHour = Number(kst.hour);
      if (currentCondition.code === 'sun' && (currentHour >= 19 || currentHour <= 5)) {
        currentCondition.code = 'night'; currentCondition.text = '맑은 밤';
      }
      const hourly = [{
        date: today, time: `${kst.hour}${kst.minute}`,
        temp: currentTemp,
        pop: nearest.POP == null ? null : Number(nearest.POP),
        sky: currentCondition,
      }, ...upcomingForecast.slice(0, 17).map((row) => {
        const sky = conditionOf(row);
        const hour = Number(String(row.time || '').slice(0, 2));
        if (sky.code === 'sun' && (hour >= 19 || hour <= 5)) { sky.code = 'night'; sky.text = '맑은 밤'; }
        return {
          date: row.date, time: row.time,
          temp: row.TMP == null ? null : Number(row.TMP),
          pop: row.POP == null ? null : Number(row.POP),
          sky,
        };
      })];
      const dailyGroups = new Map();
      for (const row of forecast) {
        if (!dailyGroups.has(row.date)) dailyGroups.set(row.date, []);
        dailyGroups.get(row.date).push(row);
      }
      const daily = [...dailyGroups.entries()].slice(0, 7).map(([date, rows]) => {
        const temps = rows.map((row) => Number(row.TMP)).filter(Number.isFinite);
        const codes = rows.map((row) => conditionOf(row).code);
        const counts = codes.reduce((acc, code) => { acc[code] = (acc[code] || 0) + 1; return acc; }, {});
        const code = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'cloud';
        return {
          date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`,
          min: temps.length ? Math.min(...temps) : null,
          max: temps.length ? Math.max(...temps) : null,
          code,
          text: conditionOf(rows.find((row) => conditionOf(row).code === code) || rows[0]).text,
          available: temps.length > 0,
        };
      });
      const result = {
        temp: Math.round(currentTemp * 10) / 10,
        min: validTemps.length ? Math.min(...validTemps) : currentTemp,
        max: validTemps.length ? Math.max(...validTemps) : currentTemp,
        condition: condition.text,
        conditionCode: condition.code,
        precipitation: popValues.length ? Math.max(...popValues) : 0,
        humidity: Number.isFinite(reh) ? reh : null,
        wind: Number.isFinite(wsd) ? wsd : null,
        hourly,
        daily,
        source: '기상청 단기예보 조회서비스',
        updatedAt: new Date().toISOString(),
        baseDate: villageBase.base_date,
        baseTime: villageBase.base_time,
      };
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(result));
    } catch (error) {
      res.statusCode = 502;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: error?.message || '기상청 API 호출에 실패했습니다.' }));
    }
  };
}
