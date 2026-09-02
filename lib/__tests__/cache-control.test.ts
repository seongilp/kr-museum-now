import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { swrCacheControl } from '../cache-control';
import { secondsUntilKstMidnight } from '../kst';

/** KST 벽시계 → UTC epoch(ms). 결정적 테스트용. */
function kst(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi, 0) - 9 * 60 * 60 * 1000;
}

function parse(cc: string): { sMaxage: number; swr: number } {
  const s = /s-maxage=(\d+)/.exec(cc);
  const w = /stale-while-revalidate=(\d+)/.exec(cc);
  assert.ok(s && w, `헤더 파싱 실패: ${cc}`);
  return { sMaxage: Number(s![1]), swr: Number(w![1]) };
}

describe('swrCacheControl — 카탈로그는 하루 단위라 자정까지 캐시', () => {
  it('낮에는 s-maxage=baseTtl, 나머지는 자정까지 stale', () => {
    const now = kst(2026, 9, 2, 10, 0);
    const { sMaxage, swr } = parse(swrCacheControl(3600, now));
    assert.equal(sMaxage, 3600);
    assert.equal(swr, secondsUntilKstMidnight(now) - 3600);
  });

  it('s-maxage + swr = 자정까지 남은 초 (stale 이 자정을 안 넘는다)', () => {
    for (const [h, mi] of [
      [0, 0],
      [12, 30],
      [23, 50],
    ] as const) {
      const now = kst(2026, 9, 2, h, mi);
      const { sMaxage, swr } = parse(swrCacheControl(3600, now));
      assert.equal(sMaxage + swr, secondsUntilKstMidnight(now), `${h}:${mi}`);
    }
  });

  it('자정 근처엔 s-maxage 가 baseTtl 아래로 줄어든다', () => {
    const now = kst(2026, 9, 2, 23, 55); // 자정까지 300초 < 3600
    const { sMaxage, swr } = parse(swrCacheControl(3600, now));
    assert.equal(sMaxage, 300);
    assert.equal(swr, 0);
  });
});
