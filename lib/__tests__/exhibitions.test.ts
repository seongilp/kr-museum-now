import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  isActiveOn,
  normalizeExhibition,
  overlaps,
  rangeFor,
  timeframeRange,
  type ExhibitionRaw,
} from '../exhibitions';
import { dayOfWeek, monthEndDay, ymdToDay } from '../kst';

const base: ExhibitionRaw = {
  seq: '301234',
  title: '기록으로 산책하기_서울의 공원',
  startDate: '20260101',
  endDate: '20261231',
  place: '서울문화재단',
  area: '서울',
  sigungu: '동대문구',
  realmName: '전시',
  thumbnail: 'http://x/y.jpg',
  gpsX: '127.03365593028',
  gpsY: '37.5715155220984',
};

describe('normalizeExhibition — 전시만, 좌표 검증', () => {
  it('realm=전시 + 좌표 → 정규화', () => {
    const e = normalizeExhibition(base)!;
    assert.ok(e);
    assert.equal(e.title, base.title);
    assert.equal(e.lat, 37.5715155220984);
    assert.equal(e.lon, 127.03365593028);
    assert.equal(e.startDay, ymdToDay('20260101'));
  });
  it('realm=공연/음악 등은 제외(전시만)', () => {
    assert.equal(normalizeExhibition({ ...base, realmName: '공연' }), null);
    assert.equal(normalizeExhibition({ ...base, realmName: '음악/콘서트' }), null);
  });
  it('기간·제목 없으면 null', () => {
    assert.equal(normalizeExhibition({ ...base, startDate: '' }), null);
    assert.equal(normalizeExhibition({ ...base, title: '' }), null);
    assert.equal(normalizeExhibition({ ...base, endDate: '20261340' }), null); // 잘못된 날짜
  });
  it('좌표 없거나 한국 밖 → 항목은 살리되 lat/lon=null(목록 전용)', () => {
    const noc = normalizeExhibition({ ...base, gpsX: '', gpsY: '' })!;
    assert.ok(noc);
    assert.equal(noc.lat, null);
    assert.equal(noc.lon, null);
    const abroad = normalizeExhibition({ ...base, gpsX: '2.35', gpsY: '48.86' })!;
    assert.equal(abroad.lat, null);
  });
});

describe('isActiveOn / overlaps', () => {
  const e = normalizeExhibition({ ...base, startDate: '20260901', endDate: '20260910' })!;
  it('진행중 판정', () => {
    assert.equal(isActiveOn(e, ymdToDay('20260905')!), true);
    assert.equal(isActiveOn(e, ymdToDay('20260901')!), true); // 시작일 포함
    assert.equal(isActiveOn(e, ymdToDay('20260910')!), true); // 종료일 포함
    assert.equal(isActiveOn(e, ymdToDay('20260911')!), false);
    assert.equal(isActiveOn(e, ymdToDay('20260831')!), false);
  });
  it('기간 교차', () => {
    assert.equal(overlaps(e, ymdToDay('20260908')!, ymdToDay('20260920')!), true);
    assert.equal(overlaps(e, ymdToDay('20260820')!, ymdToDay('20260830')!), false);
  });
});

describe('rangeFor / timeframeRange — 시간축', () => {
  const today = ymdToDay('20260902')!; // 수요일(dow=3)
  const dow = dayOfWeek(today);
  const me = monthEndDay(today);
  it('오늘 요일 확인(수=3), 9월 말일=20260930', () => {
    assert.equal(dow, 3);
    assert.equal(me, ymdToDay('20260930'));
  });
  it("today → [오늘,오늘]", () => {
    assert.deepEqual(rangeFor('today', today, me, dow), { from: today, to: today });
  });
  it("month → [오늘, 이번달 말일]", () => {
    assert.deepEqual(rangeFor('month', today, me, dow), { from: today, to: me });
  });
  it('weekend(수요일 기준) → 다가오는 토·일(9/5~9/6)', () => {
    assert.deepEqual(timeframeRange(today, me, dow), {
      from: ymdToDay('20260905'),
      to: ymdToDay('20260906'),
    });
  });
  it('weekend(토요일 기준) → 토·일 둘 다', () => {
    const sat = ymdToDay('20260905')!; // 토(dow=6)
    assert.equal(dayOfWeek(sat), 6);
    assert.deepEqual(timeframeRange(sat, me, dayOfWeek(sat)), { from: sat, to: sat + 1 });
  });
});
