import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveRegionFromReverseAddress, latLonToKmaGrid } from '../src/location-resolution.js';

const regions = JSON.parse(await readFile(new URL('../src/data-mirror/region-map.json', import.meta.url), 'utf8'));

test('실제 Nominatim 응답: city=서울특별시, borough=마포구, suburb=서강동, neighbourhood=17통이면 마포구 격자행을 사용하고 서강동을 표시한다', () => {
  const result = resolveRegionFromReverseAddress({
    city: '서울특별시',
    borough: '마포구',
    suburb: '서강동',
    neighbourhood: '17통',
  }, regions);

  assert.equal(result?.sido, '서울특별시');
  assert.equal(result?.sigungu, '마포구');
  assert.equal(result?.dong, '');
  assert.equal(result?.isAggregate, true);
  assert.equal(result?.displayDong, '서강동');
  assert.equal(result?.label, '서울특별시 마포구 서강동');
  assert.equal(result?.zone, '서울_서');
  assert.equal(Number(result?.nx), 59);
  assert.equal(Number(result?.ny), 127);
});

test('상위 행정구역이 주어지면 정확한 법정동을 선택한다', () => {
  const result = resolveRegionFromReverseAddress({
    city: '서울특별시',
    borough: '마포구',
    suburb: '창전동',
    neighbourhood: '17통',
  }, regions);

  assert.equal(result?.sido, '서울특별시');
  assert.equal(result?.sigungu, '마포구');
  assert.equal(result?.dong, '창전동');
  assert.equal(String(result?.id), '348');
  assert.equal(result?.isAggregate, undefined);
});

test('숫자 통 단위는 같은 번호의 동으로 잘못 바꾸지 않는다', () => {
  const synthetic = [...regions, {
    id: 999999,
    sido: '서울특별시',
    sigungu: '마포구',
    dong: '17동',
    zone: '서울_서',
    nx: 59,
    ny: 127,
  }];
  const result = resolveRegionFromReverseAddress({
    city: '서울특별시',
    borough: '마포구',
    neighbourhood: '17통',
  }, synthetic);

  assert.equal(result?.isAggregate, true);
  assert.notEqual(result?.dong, '17동');
});

test('neighbourhood의 통 표기를 동으로 바꾸지 않고 구 단위 집계행을 사용한다', () => {
  const result = resolveRegionFromReverseAddress({
    city: '서울특별시',
    borough: '마포구',
    neighbourhood: '창전통',
  }, regions);

  assert.equal(result?.isAggregate, true);
  assert.equal(result?.dong, '');
  assert.notEqual(result?.dong, '창전동');
});

test('시군구와 시도가 일치하지 않으면 다른 지역을 선택하지 않는다', () => {
  const result = resolveRegionFromReverseAddress({
    state: '경기도',
    city: '서울특별시',
    borough: '마포구',
    suburb: '서강동',
  }, regions);
  assert.equal(result, null);
});

test('상위 지역 정보 없이 중복된 동 이름만 있으면 모호한 결과를 거부한다', () => {
  const result = resolveRegionFromReverseAddress({ suburb: '창전동' }, regions);
  assert.equal(result, null);
});

test('실제 전달된 GPS 좌표에서 기상청 격자를 계산한다', () => {
  const grid = latLonToKmaGrid(37.550168017292826, 126.9249502780837);
  assert.deepEqual(grid, { nx: 59, ny: 126 });
});
