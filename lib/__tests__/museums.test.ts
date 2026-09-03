import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  itemsOf,
  isMuseumKind,
  kindOf,
  normalizeMuseum,
  parseApiError,
  sanitizeText,
  sidoOf,
  totalOf,
  type MuseumListRaw,
} from '../museums';

describe('kindOf / sidoOf — lclsSystm3·areacode 매핑', () => {
  it('lclsSystm3 → 종류(박물관류만). cat3 빈값이어도 lcls 로 잡힌다(국립중앙박물관 함정)', () => {
    assert.equal(kindOf('VE070100'), 'museum'); // 박물관 (국립중앙박물관: cat3 빈값이어도 VE070100)
    assert.equal(kindOf('VE070600'), 'gallery'); // 미술관/화랑
    assert.equal(kindOf('VE070300'), 'exhibition'); // 전시관
    assert.equal(kindOf('VE070200'), 'memorial'); // 기념관/문학관
    assert.equal(kindOf('VE070500'), 'science'); // 과학관/천문대
    assert.equal(kindOf('VE060100'), null); // 공연장/아트홀 제외
    assert.equal(kindOf('VE090300'), null); // 도서관 제외
    assert.equal(kindOf('VE120100'), null); // 책방·서점 제외
    assert.equal(kindOf(''), null);
    assert.equal(kindOf(undefined), null);
    assert.equal(kindOf(' VE070100 '), 'museum'); // trim
  });

  it("isMuseumKind: 6종만 true, 'other' 포함", () => {
    for (const k of ['museum', 'gallery', 'exhibition', 'memorial', 'science', 'other']) {
      assert.equal(isMuseumKind(k), true, k);
    }
    assert.equal(isMuseumKind('theater'), false);
    assert.equal(isMuseumKind(null), false);
    assert.equal(isMuseumKind(undefined), false);

  });
  it('areacode → 시도 key', () => {
    assert.equal(sidoOf('1'), 'seoul');
    assert.equal(sidoOf('31'), 'gyeonggi');
    assert.equal(sidoOf('39'), 'jeju');
    assert.equal(sidoOf('99'), null);
    assert.equal(sidoOf(undefined), null);
  });
  it('★ areacode 빈값이면 addr1 로 대체(국립중앙박물관 함정)', () => {
    assert.equal(sidoOf('', '서울특별시 용산구 서빙고로'), 'seoul');
    assert.equal(sidoOf(undefined, '강원특별자치도 강릉시'), 'gangwon');
    assert.equal(sidoOf('', '전북특별자치도 익산시'), 'jeonbuk');
    // "경기도 광주시" 를 gwangju 로 오인하지 않는다
    assert.equal(sidoOf('', '경기도 광주시 초월읍'), 'gyeonggi');
    assert.equal(sidoOf('', '광주광역시 북구'), 'gwangju');
    assert.equal(sidoOf('', ''), null);
  });
});

describe('sanitizeText — <br>→줄바꿈, 태그 제거', () => {
  it('관람시간 HTML 을 읽기 좋게', () => {
    assert.equal(sanitizeText('[관람시간]<br>\n- 10:00~18:00'), '[관람시간]\n- 10:00~18:00');
    assert.equal(sanitizeText(''), null);
    assert.equal(sanitizeText(undefined), null);
  });
});

const base: MuseumListRaw = {
  contentid: '130446',
  title: '가회민화박물관',
  addr1: '서울특별시 종로구',
  cat3: 'A02060100',
  lclsSystm3: 'VE070100',
  areacode: '1',
  mapx: '126.9852783115',
  mapy: '37.5815442900',
  firstimage: 'https://tong.visitkorea.or.kr/x.jpg',
};

describe('normalizeMuseum — lclsSystm3 분류·좌표 가드·한국어 보존', () => {
  it('정상 항목: 한국어 제목 보존, lclsSystm3 로 분류, source=cat3(둘 다 있음)', () => {
    const m = normalizeMuseum(base, { restdateculture: '매주 월요일', usefee: '5,000원' });
    assert.ok(m);
    assert.equal(m!.title, '가회민화박물관');
    assert.equal(m!.kind, 'museum');
    assert.equal(m!.sido, 'seoul');
    assert.equal(m!.restRaw, '매주 월요일');
    assert.equal(m!.fee, '5,000원');
    assert.equal(m!.source, 'cat3');
    assert.equal(m!.lat, 37.58154429);
    assert.equal(m!.lon, 126.9852783115);
  });
  it('★ cat3 빈값이어도 lclsSystm3 로 잡힌다(국립중앙박물관), source=lcls', () => {
    const m = normalizeMuseum(
      { ...base, title: '국립중앙박물관', cat3: '', lclsSystm3: 'VE070100' },
      null,
    );
    assert.ok(m);
    assert.equal(m!.kind, 'museum');
    assert.equal(m!.source, 'lcls'); // cat3 빈값 → 신형 분류로만 잡힘
  });
  it('과학관(VE070500) → kind=science', () => {
    assert.equal(normalizeMuseum({ ...base, lclsSystm3: 'VE070500' }, null)!.kind, 'science');
  });
  it('좌표 없음 → null(지도에 못 찍음)', () => {
    assert.equal(normalizeMuseum({ ...base, mapx: '', mapy: '' }, null), null);
  });
  it('한국 밖 좌표 → null', () => {
    assert.equal(normalizeMuseum({ ...base, mapx: '2.35', mapy: '48.86' }, null), null);
  });
  it('비박물관 lclsSystm3(도서관 VE090300) → null(혼입 차단)', () => {
    assert.equal(normalizeMuseum({ ...base, lclsSystm3: 'VE090300' }, null), null);
  });
  it('제목 없음 → null', () => {
    assert.equal(normalizeMuseum({ ...base, title: '' }, null), null);
  });
  it('상세 없어도 목록은 산다(restRaw=null)', () => {
    const m = normalizeMuseum(base, null);
    assert.ok(m);
    assert.equal(m!.restRaw, null);
    assert.equal(m!.hours, null);
  });
});

describe('itemsOf / totalOf / parseApiError — 3구조 응답', () => {
  it('정상 구조: response.body.items.item (배열/단일)', () => {
    const arr = { response: { body: { items: { item: [{ contentid: '1' }, { contentid: '2' }] } } } };
    assert.equal(itemsOf(arr).length, 2);
    const single = { response: { body: { items: { item: { contentid: '1' } } } } };
    assert.equal(itemsOf(single).length, 1);
    assert.equal(itemsOf({ response: { body: { items: '' } } }).length, 0); // 0건
    assert.equal(totalOf({ response: { body: { totalCount: 230 } } }), 230);
  });
  it('게이트웨이 에러: OpenAPI_ServiceResponse.cmmMsgHeader (30=미신청)', () => {
    const err = {
      OpenAPI_ServiceResponse: { cmmMsgHeader: { returnReasonCode: '30', errMsg: 'NOT_REGISTERED' } },
    };
    assert.deepEqual(parseApiError(err), { code: '30', msg: 'NOT_REGISTERED' });
  });
  it('정상 header(0000)는 에러 아님', () => {
    assert.equal(parseApiError({ response: { header: { resultCode: '0000' } } }), null);
  });
  it('평면 파라미터 에러: {resultCode:"10"} (v2 에 overviewYN 붙였을 때 등)', () => {
    assert.deepEqual(parseApiError({ resultCode: '10', resultMsg: 'INVALID' }), {
      code: '10',
      msg: 'INVALID',
    });
  });
});
