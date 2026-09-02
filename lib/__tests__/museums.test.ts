import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  itemsOf,
  kindOf,
  normalizeMuseum,
  parseApiError,
  sanitizeText,
  sidoOf,
  totalOf,
  type MuseumListRaw,
} from '../museums';

describe('kindOf / sidoOf — cat3·areacode 매핑', () => {
  it('cat3 → 종류(박물관류만)', () => {
    assert.equal(kindOf('A02060100'), 'museum');
    assert.equal(kindOf('A02060500'), 'gallery');
    assert.equal(kindOf('A02060300'), 'exhibition');
    assert.equal(kindOf('A02060200'), 'memorial');
    assert.equal(kindOf('A02060400'), null); // 도서관 등은 제외(혼입 차단)
    assert.equal(kindOf(''), null);
    assert.equal(kindOf(undefined), null);
  });
  it('areacode → 시도 key', () => {
    assert.equal(sidoOf('1'), 'seoul');
    assert.equal(sidoOf('31'), 'gyeonggi');
    assert.equal(sidoOf('39'), 'jeju');
    assert.equal(sidoOf('99'), null);
    assert.equal(sidoOf(undefined), null);
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
  areacode: '1',
  mapx: '126.9852783115',
  mapy: '37.5815442900',
  firstimage: 'https://tong.visitkorea.or.kr/x.jpg',
};

describe('normalizeMuseum — 정규화·좌표 가드·한국어 보존', () => {
  it('정상 항목: 한국어 제목을 그대로 보존한다(외국어판과 다른 점)', () => {
    const m = normalizeMuseum(base, { restdateculture: '매주 월요일', usefee: '5,000원' });
    assert.ok(m);
    assert.equal(m!.title, '가회민화박물관');
    assert.equal(m!.kind, 'museum');
    assert.equal(m!.sido, 'seoul');
    assert.equal(m!.restRaw, '매주 월요일');
    assert.equal(m!.fee, '5,000원');
    assert.equal(m!.lat, 37.58154429);
    assert.equal(m!.lon, 126.9852783115);
  });
  it('좌표 없음 → null(지도에 못 찍음)', () => {
    assert.equal(normalizeMuseum({ ...base, mapx: '', mapy: '' }, null), null);
  });
  it('한국 밖 좌표 → null', () => {
    assert.equal(normalizeMuseum({ ...base, mapx: '2.35', mapy: '48.86' }, null), null);
  });
  it('비박물관 cat3(도서관 등) → null(혼입 차단)', () => {
    assert.equal(normalizeMuseum({ ...base, cat3: 'A02060400' }, null), null);
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
