import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  applyIntro,
  mergeIntros,
  normalizeMuseum,
  type Museum,
  type MuseumIntroRaw,
  type MuseumListRaw,
} from '../museums';

/**
 * 목록/상세 결합 해제(콜드 로딩 수정)의 핵심 순수 로직 검증.
 * 목록은 상세 없이 먼저 정규화되고(restRaw=null), 상세가 나중에 도착하면 mergeIntros 로 병합된다.
 * "미수집(undefined)"과 "수집됨·휴관정보 없음(null)"을 구분해 introCoverage 를 정직하게 센다.
 */

const rawSeoul: MuseumListRaw = {
  contentid: '1001',
  title: '국립중앙박물관',
  lclsSystm3: 'VE070100',
  mapx: '126.980',
  mapy: '37.523',
  areacode: '1',
  addr1: '서울특별시 용산구 서빙고로 137',
};
const rawBusan: MuseumListRaw = {
  contentid: '1002',
  title: '부산시립미술관',
  lclsSystm3: 'VE070600',
  mapx: '129.140',
  mapy: '35.170',
  areacode: '6',
};

function listMuseum(raw: MuseumListRaw): Museum {
  const m = normalizeMuseum(raw, null); // 목록 단계: 상세 미병합
  assert.ok(m, 'fixture must normalize');
  return m;
}

describe('applyIntro — 목록 Museum 에 상세 원문 병합(불변)', () => {
  it('intro=null 이면 동일 객체를 그대로 반환한다(상세 미수집)', () => {
    const m = listMuseum(rawSeoul);
    assert.equal(applyIntro(m, null), m);
    assert.equal(m.restRaw, null);
    assert.equal(m.hours, null);
  });

  it('intro 가 있으면 준정적 필드만 채운 새 객체를 만든다(원본 불변)', () => {
    const m = listMuseum(rawSeoul);
    const intro: MuseumIntroRaw = {
      restdateculture: '매주 월요일<br>1월 1일',
      usetimeculture: '10:00~18:00',
      usefee: '무료',
      parkingculture: '가능',
    };
    const merged = applyIntro(m, intro);
    assert.notEqual(merged, m); // 새 객체
    assert.equal(m.restRaw, null); // 원본 불변
    assert.equal(merged.restRaw, '매주 월요일\n1월 1일'); // <br> → 줄바꿈(sanitizeText)
    assert.equal(merged.hours, '10:00~18:00');
    assert.equal(merged.fee, '무료');
    assert.equal(merged.parking, '가능');
    // 목록 필드는 보존
    assert.equal(merged.id, m.id);
    assert.equal(merged.title, m.title);
    assert.equal(merged.lat, m.lat);
  });
});

describe('mergeIntros — 병합 + introCoverage(미수집/수집 구분)', () => {
  const museums = [listMuseum(rawSeoul), listMuseum(rawBusan)];

  it('아무 상세도 없으면 목록 그대로, coverage 0', () => {
    const { museums: out, introCoverage } = mergeIntros(museums, () => undefined);
    assert.equal(introCoverage, 0);
    assert.equal(out[0].restRaw, null);
    assert.equal(out[1].restRaw, null);
  });

  it('일부만 수집되면 그만큼만 병합, coverage 는 비율', () => {
    const store = new Map<string, MuseumIntroRaw | null>([
      ['1001', { restdateculture: '매주 월요일' }],
    ]);
    const { museums: out, introCoverage } = mergeIntros(museums, (id) =>
      store.has(id) ? (store.get(id) ?? null) : undefined,
    );
    assert.equal(introCoverage, 0.5);
    assert.equal(out[0].restRaw, '매주 월요일'); // 수집됨
    assert.equal(out[1].restRaw, null); // 미수집 → 목록 필드만
  });

  it('★ null(수집됐으나 휴관정보 없음)은 coverage 에 포함한다(결측을 값인 척 안 함의 반대 방향)', () => {
    // restdateculture 가 빈 상세도 "수집 성공"이다 → coverage 에 세되 restRaw 는 null 로 둔다.
    const { museums: out, introCoverage } = mergeIntros(museums, (id) =>
      id === '1001' ? null : undefined,
    );
    assert.equal(introCoverage, 0.5); // null 도 covered 로 카운트
    assert.equal(out[0].restRaw, null);
  });

  it('전량 수집이면 coverage 1', () => {
    const { introCoverage } = mergeIntros(museums, () => ({ restdateculture: '연중무휴' }));
    assert.equal(introCoverage, 1);
  });

  it('빈 목록이면 coverage 0(0 나눗셈 방어)', () => {
    const { museums: out, introCoverage } = mergeIntros([], () => undefined);
    assert.equal(introCoverage, 0);
    assert.deepEqual(out, []);
  });
});
