import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dayToYmd,
  kstToday,
  msUntilKstMidnight,
  secondsUntilKstMidnight,
  todayYmdKst,
} from '../kst';

const DAY_MS = 86_400_000;

describe('kstToday / todayYmdKst — 자정 경계가 KST 로 도는지', () => {
  it('KST 자정 직전/직후로 날짜가 갈린다', () => {
    // 2026-09-02 KST 00:00 = 2026-09-01 15:00 UTC
    const kstMidnight = Date.UTC(2026, 8, 1, 15, 0, 0);
    assert.equal(dayToYmd(kstToday(kstMidnight)), '20260902');
    assert.equal(dayToYmd(kstToday(kstMidnight - 1)), '20260901'); // 1ms 전은 아직 9/1
    assert.equal(dayToYmd(kstToday(kstMidnight + DAY_MS - 1)), '20260902'); // 23:59:59 여전히 9/2
  });
  it('UTC 자정이 아니라 KST 자정이 기준', () => {
    // 2026-09-02 03:00 UTC = 2026-09-02 12:00 KST → 9/2
    assert.equal(todayYmdKst(Date.UTC(2026, 8, 2, 3, 0, 0)), '20260902');
    // 2026-09-01 20:00 UTC = 2026-09-02 05:00 KST → 9/2
    assert.equal(todayYmdKst(Date.UTC(2026, 8, 1, 20, 0, 0)), '20260902');
  });
});

describe('msUntilKstMidnight / secondsUntilKstMidnight — 캐시 TTL 을 자정에서 자른다', () => {
  it('KST 자정 직후엔 거의 하루가 남는다', () => {
    const justAfter = Date.UTC(2026, 8, 1, 15, 0, 1); // 9/2 KST 00:00:01
    const ms = msUntilKstMidnight(justAfter);
    assert.ok(ms > DAY_MS - 2000 && ms <= DAY_MS, `got ${ms}`);
  });
  it('KST 자정 직전엔 아주 조금 남는다', () => {
    const justBefore = Date.UTC(2026, 8, 1, 14, 59, 59); // 9/1 KST 23:59:59
    const ms = msUntilKstMidnight(justBefore);
    assert.ok(ms > 0 && ms <= 2000, `got ${ms}`);
  });
  it('초 단위는 항상 1 이상', () => {
    assert.ok(secondsUntilKstMidnight() >= 1);
  });
});
