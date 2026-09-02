/**
 * 공연전시 API(B553457, 한국문화정보원 "한눈에보는문화정보") 중 **전시(realmName=전시)** 정규화.
 * **순수 함수만**(테스트가 붙는다). 축 2 = "지금 하는 전시".
 *
 * 실측(2026-09-02, period2):
 *  - XML 응답. 필드: seq·title·startDate·endDate·place·area·sigungu·realmName·thumbnail·gpsX·gpsY.
 *  - **좌표(gpsX=경도,gpsY=위도) 94% 보유** → 박물관과 조인 불필요. 없는 6%는 목록 전용.
 *  - startDate/endDate 100%(YYYYMMDD). realmName 으로 전시/공연/음악 구분(우리는 전시만).
 *  - from<to 범위는 교차(intersect) 의미: [today,today+N] 창에 '오늘 진행중'이 과거 시작분까지 다 잡힌다.
 *    (from==to 는 오늘 '시작'만 잡히는 함정이라 안 쓴다.)
 */

import { ymdToDay } from './kst';

export interface ExhibitionRaw {
  seq?: string;
  title?: string;
  startDate?: string;
  endDate?: string;
  place?: string;
  area?: string;
  sigungu?: string;
  realmName?: string;
  thumbnail?: string;
  gpsX?: string; // 경도
  gpsY?: string; // 위도
}

/** 클라이언트로 내보내는 정규화 전시. 좌표는 없을 수 있다(목록 전용). */
export interface Exhibition {
  id: string;
  title: string;
  place: string | null;
  area: string | null;
  sigungu: string | null;
  /** YYYYMMDD 원문(표시·정렬용). */
  startYmd: string;
  endYmd: string;
  /** 에폭 일수(필터 계산용). */
  startDay: number;
  endDay: number;
  image: string | null;
  /** 좌표(WGS84). 없으면 null → 지도에 못 찍고 목록 전용. */
  lat: number | null;
  lon: number | null;
}

/**
 * HTML 엔티티 디코드. 공연전시 API 제목/장소는 `&amp;middot;`(이중 인코딩)·`&lt;`·`&gt;` 등이
 * 섞여 온다(실측: "음향&amp;middot;영상", "&amp;lt;다른 이름&amp;gt;"). 그대로 두면 화면에 리터럴로
 * 보인다. `&amp;` 를 먼저 풀어 이중 인코딩을 한 번에 처리한 뒤 명명 엔티티를 치환한다.
 */
export function decodeEntities(v: string | undefined): string {
  if (!v) return '';
  let s = v.replace(/&amp;/g, '&');
  const map: Record<string, string> = {
    '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'",
    '&middot;': '·', '&nbsp;': ' ',
  };
  s = s.replace(/&lt;|&gt;|&quot;|&#39;|&apos;|&middot;|&nbsp;/g, (m) => map[m] ?? m);
  // 남은 숫자 엔티티(&#NNNN;) 처리.
  s = s.replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)));
  return s.replace(/\s+/g, ' ').trim();
}

const numOrNull = (v: string | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// 한국 대략 경계(WGS84). 벗어나면 좌표 없음으로.
const KR_LON = [124, 132] as const;
const KR_LAT = [33, 39] as const;

const REALM_EXHIBITION = '전시';

/**
 * 원본 → 정규화. **realmName 이 전시가 아니거나** 제목·기간이 없으면 null(전시만 남긴다).
 * 좌표는 있으면 검증해 넣고, 없거나 한국 밖이면 null(항목은 살리되 목록 전용).
 */
export function normalizeExhibition(raw: ExhibitionRaw): Exhibition | null {
  if ((raw.realmName || '').trim() !== REALM_EXHIBITION) return null;
  const id = raw.seq?.trim();
  const title = decodeEntities(raw.title);
  const startYmd = raw.startDate?.trim() || '';
  const endYmd = raw.endDate?.trim() || '';
  const startDay = ymdToDay(startYmd);
  const endDay = ymdToDay(endYmd);
  if (!id || !title || startDay == null || endDay == null) return null;

  let lon = numOrNull(raw.gpsX);
  let lat = numOrNull(raw.gpsY);
  if (lon == null || lat == null || lon < KR_LON[0] || lon > KR_LON[1] || lat < KR_LAT[0] || lat > KR_LAT[1]) {
    lon = null;
    lat = null;
  }

  return {
    id,
    title,
    place: decodeEntities(raw.place) || null,
    area: decodeEntities(raw.area) || null,
    sigungu: decodeEntities(raw.sigungu) || null,
    startYmd,
    endYmd,
    startDay,
    endDay,
    image: raw.thumbnail?.trim() || null,
    lat,
    lon,
  };
}

/** 그 날(에폭 일수) 진행중인가. */
export function isActiveOn(e: Exhibition, epochDay: number): boolean {
  return e.startDay <= epochDay && epochDay <= e.endDay;
}

/** [from,to] 기간과 겹치는가(교차). */
export function overlaps(e: Exhibition, fromDay: number, toDay: number): boolean {
  return e.startDay <= toDay && fromDay <= e.endDay;
}

export type Timeframe = 'today' | 'weekend' | 'month';

/**
 * 시간축 필터의 [from,to] 에폭 일수 범위. today 기준(KST 에폭 일수)으로 계산.
 *  - today: 오늘 하루
 *  - weekend: 이번 주(또는 다가오는) 토·일. 오늘이 주중이면 이번 주말, 주말이면 오늘 포함 주말.
 *  - month: 오늘부터 이번 달 말일까지
 */
export function timeframeRange(
  today: number,
  monthEndDay: number,
  dow: number, // 0=일 … 6=토 (today 의 요일)
): { from: number; to: number } {
  if (dow === 6) return { from: today, to: today + 1 }; // 토 → 토·일
  if (dow === 0) return { from: today, to: today }; // 일 → 오늘(일)만
  // 주중 → 다가오는 토·일
  const daysToSat = 6 - dow;
  return { from: today + daysToSat, to: today + daysToSat + 1 };
}

/** 시간축별 [from,to] 를 돌려준다. weekend 는 timeframeRange, month 는 [today, monthEnd]. */
export function rangeFor(
  tf: Timeframe,
  today: number,
  monthEndDay: number,
  dow: number,
): { from: number; to: number } {
  if (tf === 'today') return { from: today, to: today };
  if (tf === 'month') return { from: today, to: monthEndDay };
  return timeframeRange(today, monthEndDay, dow);
}
