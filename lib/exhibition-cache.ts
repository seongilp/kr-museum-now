/**
 * 전시(realmName=전시) 카탈로그 캐시. "지금 하는 전시" 축의 데이터 소스.
 *
 * 하루 1회 [오늘, 이번달말(+최소 8일)] 창을 페이징해 전시만 정규화하고 KST 자정까지 캐시한다.
 * 창을 이 범위로 잡는 이유: today/weekend/month 시간축 필터를 이 한 벌로 모두 계산하기 위해서다.
 * 상류 호출은 보통 1~2콜/일(+ Data Cache 로 인스턴스 간 공유) — 1,000/일 한도에 여유가 크다.
 *
 * 실패는 캐시하지 않는다(예외 → 라우트가 no-store 로 응답). 목록/지도의 박물관 축과 독립이라,
 * 전시 축이 실패해도 박물관 앱은 멀쩡하다(결합 해제 원칙).
 */

import { fetchExhibitionsWindow, ExhibitionApiFailure } from './exhibition-api';
import { normalizeExhibition, type Exhibition } from './exhibitions';
import { dayToYmd, kstToday, monthEndDay, msUntilKstMidnight, secondsUntilKstMidnight, todayYmdKst } from './kst';

interface Entry {
  ymd: string;
  expiresAt: number;
  exhibitions: Exhibition[];
}
let mem: Entry | null = null;
const inflight = new Map<string, Promise<Exhibition[]>>();

async function build(): Promise<Exhibition[]> {
  const today = kstToday();
  const fromYmd = dayToYmd(today);
  // 이번 달 말일까지, 단 최소 today+8(주말이 다음 달로 넘어가는 경우 대비).
  const toDay = Math.max(monthEndDay(today), today + 8);
  const raws = await fetchExhibitionsWindow(fromYmd, dayToYmd(toDay), secondsUntilKstMidnight());
  const out: Exhibition[] = [];
  for (const r of raws) {
    const e = normalizeExhibition(r); // 전시(realmName=전시)만 통과
    if (e) out.push(e);
  }
  if (out.length === 0 && raws.length === 0) {
    // 창에 아무것도 없으면(상류 이상 가능성) 예외로 던져 캐시 안 함.
    throw new ExhibitionApiFailure('EMPTY', '공연전시 응답이 비어 있습니다.');
  }
  return out;
}

/** 전시 카탈로그(전시만, 정규화). KST 자정까지 캐시. inflight 로 동시요청 합류. */
export async function getExhibitionsCached(): Promise<Exhibition[]> {
  const ymd = todayYmdKst();
  if (mem && mem.ymd === ymd && Date.now() < mem.expiresAt) return mem.exhibitions;
  const pending = inflight.get(ymd);
  if (pending) return pending;

  const p = build()
    .then((exhibitions) => {
      mem = { ymd, expiresAt: Date.now() + msUntilKstMidnight(), exhibitions };
      return exhibitions;
    })
    .finally(() => inflight.delete(ymd));
  inflight.set(ymd, p);
  return p;
}
