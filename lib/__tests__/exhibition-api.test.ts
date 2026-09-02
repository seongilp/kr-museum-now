import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseItems, readResult, totalCountOf } from '../exhibition-api';

const OK_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<response><header><resultCode>00</resultCode><resultMsg>정상입니다.</resultMsg></header>
<body><totalCount>814</totalCount><items>
<item><serviceName>전시</serviceName><seq>301234</seq><title>기록으로 산책하기</title>
<startDate>20231201</startDate><endDate>20260929</endDate><place>서울문화재단</place>
<realmName>전시</realmName><area>서울</area><sigungu>동대문구</sigungu>
<thumbnail>http://x/y.jpg</thumbnail><gpsX>127.0336</gpsX><gpsY>37.5715</gpsY></item>
<item><serviceName>공연</serviceName><seq>999</seq><title>연극 A</title>
<startDate>20260902</startDate><endDate>20260904</endDate><realmName>연극</realmName></item>
</items></body></response>`;

const ERR_XML = `<?xml version="1.0" encoding="UTF-8"?>
<OpenAPI_ServiceResponse><cmmMsgHeader>
<errMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</errMsg>
<returnAuthMsg>등록되지 않은 서비스키</returnAuthMsg>
<returnReasonCode>30</returnReasonCode>
</cmmMsgHeader></OpenAPI_ServiceResponse>`;

describe('readResult — 정상/에러 XML 구조 구분(200이 성공 아님)', () => {
  it('정상: resultCode 00 → ok', () => {
    assert.deepEqual(readResult(OK_XML), { ok: true, code: '00' });
  });
  it('에러: OpenAPI_ServiceResponse/cmmMsgHeader/returnReasonCode → ok=false, code=30', () => {
    assert.deepEqual(readResult(ERR_XML), { ok: false, code: '30' });
  });
  it('빈/알 수 없는 응답 → 실패', () => {
    assert.equal(readResult('<foo/>').ok, false);
  });
});

describe('parseItems / totalCountOf', () => {
  it('item 평면 파싱(전시+공연 다 뽑고, 전시 필터는 상위에서)', () => {
    const items = parseItems(OK_XML);
    assert.equal(items.length, 2);
    assert.equal(items[0].title, '기록으로 산책하기');
    assert.equal(items[0].gpsX, '127.0336');
    assert.equal(items[1].realmName, '연극');
  });
  it('totalCount', () => {
    assert.equal(totalCountOf(OK_XML), 814);
    assert.equal(totalCountOf('<x/>'), 0);
  });
});
