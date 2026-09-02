/**
 * 박물관·미술관 관광공사 KorService2 클라이언트. **서버 전용.**
 *
 * ── 키 인코딩 함정(형제앱들이 반복해 데인 것) ──
 * DATA_GO_KR_KEY(=HORSE) 는 이미 %-인코딩된 Encoding 키다. 쿼리스트링을 **문자열로 직접 조립**하고
 * serviceKey 는 verbatim 으로 이어붙인다. 재인코딩하면 403 SERVICE_KEY_IS_NOT_REGISTERED(code 30)
 * 가 나는데 "미신청"과 문자열이 똑같아 오진한다. 키 값은 절대 로그로 출력하지 않는다.
 *
 * ── 오퍼레이션 & 쿼터(오퍼레이션당 1,000/일) ──
 *  - areaBasedList2: cat3 4종(박물관·기념관·전시관·미술관)을 각 1페이지(numOfRows=300, 최대 230건)로.
 *    → **하루 4콜.**
 *  - detailIntro2: 목록 전건(약 629건)을 배치로. **하루 최대 ~629콜.** 인스턴스 간 중복 빌드는
 *    museum-cache 가 조립 결과를 통째로 공유 Data Cache(self-fetch)에 하루 1엔트리로 캐시해 막는다
 *    — 그래서 detailIntro2 상류 호출은 하루 실질 ~629 < 1,000.
 *
 * ── ★ 처리율 = 토큰버킷 throttle(실측 2026-09-02, 핵심) ──
 * KorService2 detailIntro2 는 **버스트 ~60건까지는 자유롭지만 그 이상을 한꺼번에 던지면 대부분
 * 코드 23(초당 제한)으로 즉시 거절**된다(629 무지연 → 60 성공/569 거절). 즉 버킷(~60) + 느린
 * 리필 구조다. 그래서 (1) **요청 시작 간격(pacer)** 으로 TPS 를 조이고 (2) 23 은 백오프 재시도로
 * 흡수한다. 실측: 시작간격 80ms(≈12.5 req/s)·동시성 6·재시도면 **629건 ≈ 50s, throttle 0건**
 * (maxDuration 60s 안에 들어온다). 더 느리게(4~7 req/s)는 오히려 낫지 않고 시간만 는다.
 *
 * ── 실패 처리 ──
 * 200 이 성공이 아니다. 본문의 resultCode/returnReasonCode 로 판정한다. 코드 23=초당제한(재시도),
 * 22=일일쿼터(재시도 말고 배치 조기중단). 모든 fetch 에 AbortSignal.timeout, 실패는 예외.
 */

import {
  CAT3_CODES,
  itemsOf,
  parseApiError,
  type MuseumIntroRaw,
  type MuseumListRaw,
} from './museums';

const HOST = 'https://apis.data.go.kr/B551011/KorService2';
const TIMEOUT_MS = 6000;
const LIST_ROWS = 300; // cat3 최대 ~230 → 한 페이지에 담긴다.
const COMMON = 'MobileOS=ETC&MobileApp=kr-museum-now&_type=json';

/** detailIntro2 배치 설정. */
const DETAIL_CONCURRENCY = 6;
/**
 * ★ 요청 시작 간격(pacer). 토큰버킷 throttle 방어의 핵심. 80ms ≈ 12.5 req/s 로 실측상 629건을
 * ~50s 에 throttle 0건으로 통과했다(동시성 6·재시도 병행). 동시성이 아니라 이 간격이 TPS 를
 * 결정한다 — 워커들이 슬롯을 나눠 가진다.
 */
const REQUEST_INTERVAL_MS = 80;
/** maxDuration(60s) 방어: 이 시간이 지나면 새 요청을 시작하지 않고 부분 결과 반환. */
const BUDGET_MS = 55_000;
/** 초당 제한(코드 23)일 때만 재시도. 일일 쿼터(22)는 재시도 없이 배치를 조기 중단. */
const THROTTLE_CODE = '23';
const DAILY_QUOTA_CODE = '22';
const RETRY_BACKOFF_MS = [700, 1400, 2500, 4000];

export class MuseumApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'MuseumApiFailure';
  }
}

function serviceKey(): string {
  const key = process.env.DATA_GO_KR_KEY?.trim() || process.env.HORSE?.trim();
  if (!key) throw new MuseumApiFailure('NO_KEY', 'DATA_GO_KR_KEY 가 설정되지 않았습니다.');
  // 이미 %-인코딩된 Encoding 키면 그대로, Decoding 키(% 없음)만 한 번 인코딩한다.
  return key.includes('%') ? key : encodeURIComponent(key);
}

/**
 * raw fetch(no-store). Next 의 per-fetch 캐시 계층을 거치지 않는다(위 주석의 직렬화 붕괴 회피).
 * 인스턴스 간 공유는 상위(museum-cache)의 unstable_cache 가 조립 결과를 통째로 캐시해 맡는다.
 */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: 'no-store',
  });
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    // 인증 오류는 _type=json 을 줘도 XML 로 떨어진다. 코드만 뽑아 실패로.
    const code = /<returnReasonCode>([^<]*)</.exec(text)?.[1] ?? 'NON_JSON';
    throw new MuseumApiFailure(code, `응답 해석 실패: ${text.slice(0, 120)}`);
  }
  const err = parseApiError(json);
  if (err) throw new MuseumApiFailure(err.code, err.msg);
  return json;
}

/** cat3 한 분류의 목록(전국). */
async function fetchListByCat3(cat3: string): Promise<MuseumListRaw[]> {
  const url =
    `${HOST}/areaBasedList2?serviceKey=${serviceKey()}&${COMMON}` +
    `&contentTypeId=14&cat1=A02&cat2=A0206&cat3=${cat3}&arrange=A&numOfRows=${LIST_ROWS}&pageNo=1`;
  return itemsOf<MuseumListRaw>(await fetchJson(url));
}

/** 박물관류 4개 cat3 목록 전량(상세 없이). cat3 가 이미 붙어 온다. */
export async function fetchMuseumList(): Promise<MuseumListRaw[]> {
  const lists = await Promise.all(CAT3_CODES.map((c) => fetchListByCat3(c)));
  return lists.flat();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 초당 제한(23)이면 백오프 후 재시도. 그 외 실패는 즉시 던진다. */
async function fetchWithThrottleRetry(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchJson(url);
    } catch (e) {
      const throttled = e instanceof MuseumApiFailure && e.code === THROTTLE_CODE;
      if (!throttled || attempt >= RETRY_BACKOFF_MS.length) throw e;
      await sleep(RETRY_BACKOFF_MS[attempt]);
    }
  }
}

/** 한 시설의 상세(관람시간·휴관일 등). 실패 시 예외(호출부가 흡수). */
export async function fetchMuseumIntro(contentId: string): Promise<MuseumIntroRaw | null> {
  const url =
    `${HOST}/detailIntro2?serviceKey=${serviceKey()}&${COMMON}` +
    `&contentId=${encodeURIComponent(contentId)}&contentTypeId=14`;
  return (
    (itemsOf<MuseumIntroRaw>(await fetchWithThrottleRetry(url))[0] as MuseumIntroRaw | undefined) ??
    null
  );
}

/**
 * contentId 목록의 상세를 동시성 풀로 배치 호출. 개별 실패는 null 로 흡수(그 항목은 휴관일
 * 원문이 없을 뿐, 전체가 무너지면 안 된다). 시간 예산(BUDGET_MS)이 다하면 남은 요청을 시작하지
 * 않고 반환한다 — 이미 받은 것 + Data Cache 로 그날 다음 빌드가 마저 채운다.
 */
export async function fetchIntrosBatch(
  ids: string[],
): Promise<Map<string, MuseumIntroRaw | null>> {
  const out = new Map<string, MuseumIntroRaw | null>();
  let cursor = 0;
  let dailyQuotaHit = false;
  const deadline = Date.now() + BUDGET_MS;

  // pacer: 다음 요청을 출발시킬 수 있는 가장 이른 시각. 워커들이 이 슬롯을 나눠 가져 시작 간격을
  // REQUEST_INTERVAL_MS 로 강제한다(토큰버킷 throttle 방어).
  let nextSlot = Date.now();
  async function pace(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + REQUEST_INTERVAL_MS;
    if (slot > now) await sleep(slot - now);
  }

  async function worker(): Promise<void> {
    while (cursor < ids.length && !dailyQuotaHit && Date.now() < deadline) {
      const id = ids[cursor];
      cursor += 1;
      await pace();
      try {
        out.set(id, await fetchMuseumIntro(id));
      } catch (e) {
        out.set(id, null); // 개별 실패는 흡수(부분 결측), 배치는 계속.
        if (e instanceof MuseumApiFailure && e.code === DAILY_QUOTA_CODE) dailyQuotaHit = true;
      }
    }
  }
  const workers = Array.from({ length: Math.min(DETAIL_CONCURRENCY, ids.length) }, worker);
  await Promise.all(workers);
  return out;
}
