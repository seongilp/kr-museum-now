import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EMPTY_FILTERS, hasAnyFilter, matchesFilters, toggleKind, type Filters } from '../facets';
import type { Museum } from '../museums';

const museum = (over: Partial<Museum>): Museum => ({
  id: '1',
  title: 'x',
  kind: 'museum',
  addr: null,
  sido: 'seoul',
  lat: 37.5,
  lon: 127,
  image: null,
  tel: null,
  restRaw: null,
  hours: null,
  fee: null,
  parking: null,
  source: 'lcls',
  ...over,
});

describe('toggleKind — 불변 다중 선택', () => {
  it('없으면 추가, 있으면 제거하고 원본은 안 바꾼다', () => {
    const a: Museum['kind'][] = [];
    const b = toggleKind(a, 'museum');
    assert.deepEqual(b, ['museum']);
    assert.deepEqual(a, []); // 불변
    assert.deepEqual(toggleKind(b, 'museum'), []);
  });
});

describe('matchesFilters — 종류·지역(AND, 종류 안은 OR)', () => {
  it('빈 필터는 전부 통과', () => {
    assert.equal(matchesFilters(museum({}), EMPTY_FILTERS), true);
  });
  it('종류 다중은 합집합', () => {
    const f: Filters = { ...EMPTY_FILTERS, kinds: ['gallery', 'exhibition'] };
    assert.equal(matchesFilters(museum({ kind: 'gallery' }), f), true);
    assert.equal(matchesFilters(museum({ kind: 'museum' }), f), false);
  });
  it('지역은 완전일치', () => {
    const f: Filters = { ...EMPTY_FILTERS, sido: 'busan' };
    assert.equal(matchesFilters(museum({ sido: 'busan' }), f), true);
    assert.equal(matchesFilters(museum({ sido: 'seoul' }), f), false);
  });
  it('종류 AND 지역', () => {
    const f: Filters = { ...EMPTY_FILTERS, kinds: ['museum'], sido: 'seoul' };
    assert.equal(matchesFilters(museum({ kind: 'museum', sido: 'seoul' }), f), true);
    assert.equal(matchesFilters(museum({ kind: 'museum', sido: 'busan' }), f), false);
  });
  it('openTodayOnly 는 matchesFilters 가 관여하지 않는다(라우트에서 처리 — 날짜 의존)', () => {
    const f: Filters = { ...EMPTY_FILTERS, openTodayOnly: true };
    assert.equal(matchesFilters(museum({}), f), true);
  });
});

describe('hasAnyFilter', () => {
  it('빈 상태 판별', () => {
    assert.equal(hasAnyFilter(EMPTY_FILTERS), false);
    assert.equal(hasAnyFilter({ ...EMPTY_FILTERS, openTodayOnly: true }), true);
    assert.equal(hasAnyFilter({ ...EMPTY_FILTERS, kinds: ['museum'] }), true);
    assert.equal(hasAnyFilter({ ...EMPTY_FILTERS, sido: 'seoul' }), true);
  });
});
