/**
 * CDN `Cache-Control` 조립. **순수 함수**(node:test 로 검증).
 *
 * 이 앱의 카탈로그(전국 캠핑장 3,109곳)는 하루에도 거의 안 바뀐다. 그래서 위치 없는
 * 요청(서울 폴백)의 응답은 그날 안에서 사실상 불변이라 CDN 이 마음껏 캐시할 수 있다.
 * TTL 이 지나도 stale 을 즉시 주고 뒤에서 갱신(stale-while-revalidate)하면 콜드 사용자도 안 기다린다.
 *
 * **stale 창을 KST 자정에서 자른다**: `s-maxage + swr = 자정까지 남은 초`. 자정을 넘긴 첫
 * 요청은 캐시가 완전히 만료돼 새 카탈로그(모듈/Data Cache 도 자정에 만료)로 다시 만든다.
 */

import { secondsUntilKstMidnight } from './kst';

/**
 * @param baseTtl 신선 주기(초). 이 시간이 지나면 CDN 이 백그라운드 재검증한다.
 * @returns `public, s-maxage=<x>, stale-while-revalidate=<y>` — x+y 는 자정까지 남은 초.
 */
export function swrCacheControl(baseTtl: number, nowMs: number = Date.now()): string {
  const untilMidnight = secondsUntilKstMidnight(nowMs);
  const sMaxage = Math.min(baseTtl, untilMidnight);
  const swr = Math.max(0, untilMidnight - sMaxage);
  return `public, s-maxage=${sMaxage}, stale-while-revalidate=${swr}`;
}
