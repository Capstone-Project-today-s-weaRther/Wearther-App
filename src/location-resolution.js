/**
 * Resolve a Nominatim reverse-geocoding address to the exact administrative
 * row in region_map. The resolver deliberately avoids fuzzy/first-result
 * fallbacks because many Korean dong names are duplicated nationwide.
 */
function text(value) {
  return value == null ? '' : String(value).trim();
}

function compact(value) {
  return text(value).normalize('NFC').replace(/[\s,·.]/g, '');
}

const SIDO_ALIASES = new Map([
  ['서울', '서울'], ['서울특별시', '서울'],
  ['부산', '부산'], ['부산광역시', '부산'],
  ['대구', '대구'], ['대구광역시', '대구'],
  ['인천', '인천'], ['인천광역시', '인천'],
  ['광주', '광주'], ['광주광역시', '광주'],
  ['대전', '대전'], ['대전광역시', '대전'],
  ['울산', '울산'], ['울산광역시', '울산'],
  ['세종', '세종'], ['세종특별자치시', '세종'],
  ['경기', '경기'], ['경기도', '경기'],
  ['강원', '강원'], ['강원도', '강원'], ['강원특별자치도', '강원'],
  ['충북', '충북'], ['충청북도', '충북'],
  ['충남', '충남'], ['충청남도', '충남'],
  ['전북', '전북'], ['전라북도', '전북'], ['전북특별자치도', '전북'],
  ['전남', '전남'], ['전라남도', '전남'],
  ['경북', '경북'], ['경상북도', '경북'],
  ['경남', '경남'], ['경상남도', '경남'],
  ['제주', '제주'], ['제주특별자치도', '제주'],
  ['전남광주통합특별시', '전남'],
]);

/** Convert WGS84 latitude/longitude to the KMA 5-km Lambert Conformal Conic grid. */
export function latLonToKmaGrid(latitude, longitude) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error('위도와 경도 값이 올바르지 않습니다.');
  }

  const earthRadiusKm = 6371.00877;
  const gridSpacingKm = 5.0;
  const standardLatitude1 = 30.0;
  const standardLatitude2 = 60.0;
  const originLongitude = 126.0;
  const originLatitude = 38.0;
  const originX = 43;
  const originY = 136;
  const radians = Math.PI / 180;
  const re = earthRadiusKm / gridSpacingKm;
  const slat1 = standardLatitude1 * radians;
  const slat2 = standardLatitude2 * radians;
  const olon = originLongitude * radians;
  const olat = originLatitude * radians;
  const sn = Math.log(Math.cos(slat1) / Math.cos(slat2)) /
    Math.log(Math.tan(Math.PI * 0.25 + slat2 * 0.5) / Math.tan(Math.PI * 0.25 + slat1 * 0.5));
  const sf = Math.pow(Math.tan(Math.PI * 0.25 + slat1 * 0.5), sn) * Math.cos(slat1) / sn;
  const ro = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + olat * 0.5), sn);
  const ra = re * sf / Math.pow(Math.tan(Math.PI * 0.25 + lat * radians * 0.5), sn);
  let theta = lon * radians - olon;
  if (theta > Math.PI) theta -= 2 * Math.PI;
  if (theta < -Math.PI) theta += 2 * Math.PI;
  theta *= sn;

  return {
    nx: Math.floor(ra * Math.sin(theta) + originX + 0.5),
    ny: Math.floor(ro - ra * Math.cos(theta) + originY + 0.5),
  };
}

function sidoKey(value) {
  const key = compact(value);
  if (!key || key === '대한민국' || key === '한국') return '';
  if (SIDO_ALIASES.has(key)) return SIDO_ALIASES.get(key);
  return key.replace(/특별자치도$|특별자치시$|특별시$|광역시$|자치도$|도$/u, '');
}

function sigunguKey(value) {
  const key = compact(value);
  if (!key || key === '대한민국' || key === '한국') return '';
  return key.replace(/특별자치시$|시$|군$|구$/u, '');
}

function dongNameVariants(value) {
  // Do not translate 통 to 동. Nominatim may return a neighbourhood block
  // (e.g. 17통), which is not the legal/administrative dong used by region_map.
  // Only exact locality names may match a dong row; otherwise use a verified
  // parent-district aggregate rather than guessing a different dong.
  const name = compact(value);
  return name ? [name] : [];
}

function uniqueKnownParent(rawValues, knownValues, normalize) {
  for (const raw of rawValues) {
    const key = normalize(raw);
    if (key && knownValues.has(key)) return key;
  }
  return '';
}

/**
 * @param {Record<string, string>} address Nominatim `address` object.
 * @param {Array<Record<string, any>>} regionRows rows from region_map mirror.
 * @returns {Record<string, any> | null} Exact dong row, exact district aggregate,
 *          or null when the returned address is ambiguous/unresolvable.
 */
export function resolveRegionFromReverseAddress(address, regionRows) {
  if (!address || !Array.isArray(regionRows) || !regionRows.length) return null;

  const rows = regionRows.map((row) => ({
    ...row,
    sido: text(row.sido),
    sigungu: text(row.sigungu),
    dong: text(row.dong),
  }));

  const knownSido = new Set(rows.map((row) => sidoKey(row.sido)).filter(Boolean));
  const knownSigungu = new Set(rows.map((row) => sigunguKey(row.sigungu)).filter(Boolean));

  // Select the most specific values that actually exist in this project's
  // official region_map data. For Seoul, for example, city=서울특별시 is not
  // mistaken for a sigungu; city_district=마포구 is selected instead.
  const expectedSido = uniqueKnownParent(
    [address.state, address.province, address.region, address.state_district, address.city],
    knownSido,
    sidoKey,
  );
  const expectedSigungu = uniqueKnownParent(
    [address.city_district, address.county, address.borough, address.district,
      address.municipality, address.city, address.town],
    knownSigungu,
    sigunguKey,
  );

  const parentMatches = (row) => {
    if (expectedSido && sidoKey(row.sido) !== expectedSido) return false;
    if (expectedSigungu && sigunguKey(row.sigungu) !== expectedSigungu) return false;
    return true;
  };

  // In Korean Nominatim responses `suburb` may carry the administrative
  // dong (e.g. 서강동), while `neighbourhood` may be a smaller tong unit
  // (e.g. 17통). Prefer suburb and never let a numbered tong outrank it.
  const localityFields = [
    address.suburb,
    address.neighbourhood,
    address.quarter,
    address.village,
    address.hamlet,
    address.residential,
    address.isolated_dwelling,
    address.town,
    address.city,
    address.city_district,
    address.county,
  ].map(text).filter(Boolean);

  const tried = new Set();
  for (const locality of localityFields) {
    for (const variant of dongNameVariants(locality)) {
      if (tried.has(variant)) continue;
      tried.add(variant);
      const matches = rows.filter((row) => row.dong && compact(row.dong) === variant && parentMatches(row));
      // Never pick the first result when duplicate legal dong names remain.
      if (matches.length === 1) return matches[0];
    }
  }

  // A district-level selection is acceptable only when both the province and
  // sigungu match a real aggregate row in region_map. It is safer than silently
  // choosing an unrelated dong elsewhere in the country.
  if (expectedSido && expectedSigungu) {
    const aggregates = rows.filter((row) => !row.dong && parentMatches(row));
    if (aggregates.length === 1) {
      const row = aggregates[0];
      const displayDong = text(address.suburb) || '';
      const displayLabel = [text(address.city), text(address.borough || address.city_district || address.county), displayDong]
        .filter(Boolean)
        .join(' ');
      return {
        ...row,
        id: `aggregate-${row.sido}-${row.sigungu}`,
        isAggregate: true,
        // Keep the DB's aggregate row (and its nx/ny) for weather lookup, but
        // preserve Nominatim's actual administrative-dong name for display.
        displayDong,
        label: displayLabel || `${row.sido}, ${row.sigungu} 전체`,
      };
    }
  }

  return null;
}
