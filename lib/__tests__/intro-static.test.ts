import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EMPTY_SNAPSHOT,
  idsMissingIntro,
  makeIntroLookup,
  parseSnapshot,
  pickIntroFields,
  planCollection,
  withResults,
  type IntroSnapshot,
} from '../intro-static';
import { mergeIntros, normalizeMuseum, type Museum, type MuseumIntroRaw } from '../museums';

/**
 * 정적 스냅샷(리포 JSON) 우선 + 인스턴스 메모리 덮어쓰기 병합의 순수 규칙 검증.
 * 런타임 회전은 정적본에 없는 id 만 쿼터를 써야 하고, coverage 는 둘의 합산이어야 한다.
 */

const snap: IntroSnapshot = {
  collectedAt: '2026-09-03T01:00:00.000Z',
  byId: {
    '1001': { restdateculture: '매주 월요일' },
    '1002': null, // 수집됐으나 상세 없음
  },
  fetchedAt: { '1001': '2026-09-01', '1002': '2026-09-03' },
};

describe('makeIntroLookup — 정적본 우선, 동적본이 덮어쓴다', () => {
  it('동적 저장소에 없으면 정적본을 돌려준다(null 도 "수집됨")', () => {
    const lookup = makeIntroLookup(snap, () => undefined);
    assert.deepEqual(lookup('1001'), { restdateculture: '매주 월요일' });
    assert.equal(lookup('1002'), null);
    assert.equal(lookup('9999'), undefined); // 어디에도 없음 = 미수집
  });

  it('동적 저장소에 있으면 정적본을 덮어쓴다(회전 수집이 더 최신)', () => {
    const dyn = new Map<string, MuseumIntroRaw | null>([['1001', { restdateculture: '연중무휴' }]]);
    const lookup = makeIntroLookup(snap, (id) => (dyn.has(id) ? (dyn.get(id) ?? null) : undefined));
    assert.deepEqual(lookup('1001'), { restdateculture: '연중무휴' });
    assert.equal(lookup('1002'), null); // 동적에 없으니 정적 유지
  });

  it('동적 null(수집됐으나 상세 없음)도 정적본을 덮어쓴다 — undefined 만 "없음"이다', () => {
    const lookup = makeIntroLookup(snap, (id) => (id === '1001' ? null : undefined));
    assert.equal(lookup('1001'), null);
  });

  it('프로토타입 키(constructor 등)는 정적본 항목으로 오인하지 않는다', () => {
    const lookup = makeIntroLookup(snap, () => undefined);
    assert.equal(lookup('constructor'), undefined);
    assert.equal(lookup('__proto__'), undefined);
  });
});

describe('mergeIntros + makeIntroLookup — introCoverage 는 정적+동적 합산', () => {
  const mk = (id: string): Museum => {
    const m = normalizeMuseum(
      { contentid: id, title: `m${id}`, lclsSystm3: 'VE070100', mapx: '127', mapy: '37' },
      null,
    );
    assert.ok(m);
    return m;
  };
  const museums = ['1001', '1002', '1003', '1004'].map(mk);

  it('정적 2 + 동적 1(신규) → 3/4', () => {
    const dyn = new Map<string, MuseumIntroRaw | null>([['1003', { usefee: '무료' }]]);
    const { museums: out, introCoverage } = mergeIntros(
      museums,
      makeIntroLookup(snap, (id) => (dyn.has(id) ? (dyn.get(id) ?? null) : undefined)),
    );
    assert.equal(introCoverage, 0.75);
    assert.equal(out[0].restRaw, '매주 월요일');
    assert.equal(out[2].fee, '무료');
    assert.equal(out[3].restRaw, null); // 미수집
  });

  it('정적본이 비어 있으면 동적본만으로 계산(기존 동작과 동일)', () => {
    const { introCoverage } = mergeIntros(museums, makeIntroLookup(EMPTY_SNAPSHOT, () => undefined));
    assert.equal(introCoverage, 0);
  });
});

describe('idsMissingIntro — 회전 대상은 정적·동적 어디에도 없는 id 만', () => {
  it('정적본에 있는 id 는 제외, 동적에 있는 id 도 제외, 순서 보존', () => {
    const ids = ['1001', '1002', '1003', '1004', '1005'];
    const out = idsMissingIntro(ids, snap, (id) => id === '1004');
    assert.deepEqual(out, ['1003', '1005']);
  });
});

describe('planCollection — 스크립트의 대상 선정', () => {
  const ids = ['1001', '1002', '1003'];
  it('기본: 스냅샷에 없는 id 만', () => {
    assert.deepEqual(planCollection(ids, snap, false), ['1003']);
  });
  it('--force: 전량을, 가장 오래 받은 것(없음 → 최우선)부터', () => {
    assert.deepEqual(planCollection(ids, snap, true), ['1003', '1001', '1002']);
  });
  it('--force 에서 fetchedAt 이 같으면 카탈로그 순서 유지(안정 정렬)', () => {
    const s: IntroSnapshot = { ...snap, fetchedAt: { '1001': '2026-09-01', '1002': '2026-09-01' } };
    assert.deepEqual(planCollection(['1002', '1001', '1003'], s, true), ['1003', '1002', '1001']);
  });
});

describe('withResults — 불변 병합', () => {
  it('새 객체를 만들고 원본을 건드리지 않는다; 목록에서 빠진 id 는 보존', () => {
    const results = new Map<string, MuseumIntroRaw | null>([
      ['1001', { restdateculture: '매주 화요일' }],
      ['1003', null],
    ]);
    const next = withResults(snap, results, '2026-09-10', '2026-09-10T00:00:00.000Z');
    assert.notEqual(next, snap);
    assert.deepEqual(snap.byId['1001'], { restdateculture: '매주 월요일' }); // 원본 불변
    assert.deepEqual(next.byId['1001'], { restdateculture: '매주 화요일' });
    assert.equal(next.byId['1002'], null); // 결과에 없어도 보존
    assert.equal(next.byId['1003'], null);
    assert.equal(next.fetchedAt['1001'], '2026-09-10');
    assert.equal(next.fetchedAt['1002'], '2026-09-03');
    assert.equal(next.collectedAt, '2026-09-10T00:00:00.000Z');
  });
});

describe('pickIntroFields / parseSnapshot — 외부 데이터 검증', () => {
  it('필요 필드만 남기고 빈 문자열·낯선 필드는 버린다', () => {
    assert.deepEqual(
      pickIntroFields({ contentid: '1', restdateculture: '매주 월요일', usefee: '', foo: 'bar' }),
      { restdateculture: '매주 월요일' },
    );
    assert.equal(pickIntroFields(null), null);
  });
  it('모양이 틀린 JSON 은 빈 스냅샷으로(런타임을 죽이지 않는다)', () => {
    assert.deepEqual(parseSnapshot(null), EMPTY_SNAPSHOT);
    assert.deepEqual(parseSnapshot({ byId: 'nope' }), EMPTY_SNAPSHOT);
    assert.deepEqual(parseSnapshot([]), EMPTY_SNAPSHOT);
  });
  it('정상 JSON 은 필드를 정리해 받아들인다(null 보존, fetchedAt 문자열만)', () => {
    const p = parseSnapshot({
      collectedAt: 'x',
      byId: { a: { restdateculture: '연중무휴', junk: 1 }, b: null, c: 3 },
      fetchedAt: { a: '2026-09-01', b: 5 },
    });
    assert.deepEqual(p, {
      collectedAt: 'x',
      byId: { a: { restdateculture: '연중무휴' }, b: null },
      fetchedAt: { a: '2026-09-01' },
    });
  });
});
