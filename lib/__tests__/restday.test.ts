import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { openTodayState, parseClosure, verdictFor } from '../restday';

/**
 * 휴관일 한국어 파서 — 이 앱의 성패. 실측 restdateculture 문구를 기준으로 검증한다.
 * 기준 에폭 일수(node 로 계산):
 *   20703 = 2026-09-07 월요일(1주차 월)
 *   20704 = 2026-09-08 화요일(2주차 화)
 *   20702 = 2026-09-06 일요일
 *   20724 = 2026-09-28 월요일(9월 마지막 월)
 *   20725 = 2026-09-29 화요일(5주차 화)
 */
const MON = 20703; // 첫째 월요일
const TUE = 20704; // 둘째 화요일
const SUN = 20702; // 일요일
const LAST_MON = 20724; // 마지막(넷째) 월요일

describe('parseClosure — 한국어 주간 요일', () => {
  it('"매주 월요일" → 월요일만', () => {
    assert.deepEqual(parseClosure('매주 월요일').weekly, [1]);
  });
  it('"매주 월, 화요일" / "월·화요일" → 월·화', () => {
    assert.deepEqual(parseClosure('매주 월, 화요일').weekly, [1, 2]);
    assert.deepEqual(parseClosure('월·화요일 휴관').weekly, [1, 2]);
  });
  it('"주말"=토·일, "평일"=월~금', () => {
    assert.deepEqual(parseClosure('주말').weekly, [0, 6]);
    assert.deepEqual(parseClosure('평일 휴관').weekly, [1, 2, 3, 4, 5]);
  });
});

describe('parseClosure — 연중무휴 / 없음', () => {
  it('"연중무휴" / "없음" / "휴관일 없음" → openAllYear', () => {
    assert.equal(parseClosure('연중무휴').openAllYear, true);
    assert.equal(parseClosure('없음').openAllYear, true);
    assert.equal(parseClosure('휴관일 없음').openAllYear, true);
  });
});

describe('parseClosure — 서수(매월 N째 주 요일)를 주간과 분리', () => {
  it('"매월 첫째, 셋째 주 월요일" → 서수 2건, 주간 없음(오독 방지)', () => {
    const c = parseClosure('매월 첫째, 셋째 주 월요일');
    assert.equal(c.weekly.length, 0, '월요일이 매주로 오독되면 안 된다');
    assert.deepEqual(
      c.ordinals.map((o) => o.nth),
      [1, 3],
    );
    assert.equal(c.ordinals[0].weekday, 1);
  });
  it('"매월 마지막 주 월요일" → last', () => {
    const c = parseClosure('매월 마지막 주 월요일');
    assert.equal(c.ordinals[0].nth, 'last');
    assert.equal(c.weekly.length, 0);
  });
});

describe('parseClosure — 공휴일/명절(소프트)', () => {
  it('"1월 1일, 설날 및 추석 당일" → 주간 없음, holidayCaveat', () => {
    const c = parseClosure('1월 1일, 설날 및 추석 당일');
    assert.equal(c.weekly.length, 0);
    assert.equal(c.holidayCaveat, true);
  });
});

describe('parseClosure — 하드(판정 불가) 절', () => {
  it('"전시 준비기간", "홈페이지 참조", "별도 공지" → hard', () => {
    assert.equal(parseClosure('전시 준비기간').hard, true);
    assert.equal(parseClosure('홈페이지 참조').hard, true);
    assert.equal(parseClosure('별도 공지').hard, true);
  });
  it('요일 범위("화~일요일")는 방향 모호 → hard', () => {
    assert.equal(parseClosure('화~일요일').hard, true);
  });
});

describe('verdictFor — 오늘 개관/휴관/판정불가', () => {
  it('"매주 월요일": 월요일=휴관, 화요일=개관', () => {
    const c = parseClosure('매주 월요일');
    assert.equal(verdictFor(c, MON), 'closed');
    assert.equal(verdictFor(c, TUE), 'open');
  });
  it('"연중무휴": 언제나 개관', () => {
    assert.equal(openTodayState('연중무휴', MON), 'open');
    assert.equal(openTodayState('연중무휴', SUN), 'open');
  });
  it('서수 "매월 첫째 주 월요일": 첫째 월요일=휴관, 넷째 월요일=개관', () => {
    const c = parseClosure('매월 첫째 주 월요일');
    assert.equal(verdictFor(c, MON), 'closed'); // 9/7 = 1주차 월
    assert.equal(verdictFor(c, LAST_MON), 'open'); // 9/28 = 4주차 월
  });
  it('서수 "매월 마지막 주 월요일": 마지막 월요일=휴관', () => {
    const c = parseClosure('매월 마지막 주 월요일');
    assert.equal(verdictFor(c, LAST_MON), 'closed');
    assert.equal(verdictFor(c, MON), 'open');
  });
  it('명절만 휴관 → 오늘은 개관(공휴일 판정은 고지문으로 덮음)', () => {
    assert.equal(openTodayState('1월 1일, 설날, 추석 당일', TUE), 'open');
  });
  it('하드 절이 있으면(요일 규칙 넘어섬) unknown — 파싱 실패를 개관으로 처리하지 않는다', () => {
    assert.equal(openTodayState('전시 준비기간', TUE), 'unknown');
    assert.equal(openTodayState('상시 변동, 홈페이지 확인', TUE), 'unknown');
  });
  it('빈 값/해석 불가 → unknown', () => {
    assert.equal(openTodayState('', TUE), 'unknown');
    assert.equal(openTodayState(null, TUE), 'unknown');
    assert.equal(openTodayState('무(웹공지)', TUE), 'unknown');
  });
  it('주간 + 명절 예외 병기: 오늘이 그 요일이 아니면 개관', () => {
    // "매주 월요일(월요일이 공휴일인 경우 그 다음날)" → 화요일엔 개관
    assert.equal(openTodayState('매주 월요일(월요일이 공휴일인 경우 그 다음날)', TUE), 'open');
    assert.equal(openTodayState('매주 월요일(월요일이 공휴일인 경우 그 다음날)', MON), 'closed');
  });
});
