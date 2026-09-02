/**
 * 박물관 카탈로그(목록 + 상세 병합, 정규화 완료) 캐시. 이 앱 쿼터·성능 방어의 핵심이다.
 *
 * ── ★ 목록과 상세를 결합 해제한다(핵심 원칙) ──
 * `areaBasedList2`(목록: 이름·좌표·주소)와 `detailIntro2`(상세: 휴관일·관람시간)는 **별개
 * 오퍼레이션이고 일일 쿼터도 따로**다. 상세가 쿼터 소진(code 22)돼도 **목록·지도·이름은 살아
 * 있어야 한다.** 그래서 상세 병합률이 낮아도 502 로 죽이지 않고, 병합률을 응답 메타에 실어
 * 클라이언트가 "오늘 여는 곳" 판정 가능 여부를 알게 한다. (형제앱 kr-events-now 가 "병합률<임계
 * → 502" 가드로 목록까지 죽였던 결함을 그대로 답습하지 않는다.)
 *
 * ── 처리·쿼터 ──
 * detailIntro2 는 토큰버킷 throttle(버스트~60, code 23)이 있어 pacer(≈12.5 req/s)+재시도로 조여야
 * 하고 629건 ≈50s(museum-api). 이 50s 배치를 콜드 인스턴스마다 새로 돌리면 상류 629콜×인스턴스로
 * 일일 쿼터(1,000/op)를 위협하므로, **완전 빌드는 조립 결과를 통째로 공유 Data Cache(self-fetch
 * → /api/catalog)에 하루 1엔트리로** 태워 인스턴스 간 공유한다(상류 실질 ≈629/일 < 1,000).
 *
 * ── ★ 부분 빌드는 자정까지 굳히지 않는다 ──
 *  - **완전 빌드**(병합률 ≥ FULL_COVERAGE): KST 자정까지 캐시(모듈 + 공유 Data Cache 200).
 *  - **부분 빌드**(상세 쿼터·throttle 로 병합률 낮음): 목록은 그대로 내보내되 **짧게(PARTIAL_TTL)만**
 *    캐시하고 공유 Data Cache 에는 태우지 않는다(/api/catalog 가 503 을 주고, Next 는 비-2xx 를
 *    Data Cache 에 담지 않는다). 쿼터가 회복되면 다음 빌드가 자동으로 완전 빌드로 채운다.
 *  - 쿼터 소진(code 22) 감지 시 배치를 조기 중단한다(museum-api) — 남은 걸 더 때려도 전부 거절이다.
 *  - **목록 자체가 비면**(areaBasedList2 실패=진짜 장애) 그때만 던진다(빈 카탈로그를 캐시·서빙 금지).
 */

import { fetchIntrosBatch, fetchMuseumList, MuseumApiFailure } from './museum-api';
import { normalizeMuseum, type Museum } from './museums';
import { msUntilKstMidnight, secondsUntilKstMidnight, todayYmdKst } from './kst';
import { selfBaseUrl } from './self';

/** 이 이상이면 완전 빌드로 보고 자정까지 캐시. 미만은 부분 빌드(짧게만 캐시, 공유 X). */
export const FULL_COVERAGE = 0.9;
/** 부분 빌드의 짧은 캐시 수명(쿼터 회복 후 자동 재빌드되도록). */
const PARTIAL_TTL_MS = 7 * 60 * 1000;

/** 전량 카탈로그(정규화 완료). introCoverage 로 "오늘 여는가" 판정 신뢰도를 노출한다. */
export interface Catalog {
  museums: Museum[];
  introCoverage: number;
  noCoords: number;
}

/** 완전 빌드 여부까지 함께(캐시 TTL·응답 status 결정용). */
export interface CatalogResult {
  catalog: Catalog;
  full: boolean;
}

/**
 * 원본 수집 → 조립. paced 배치(개별 fetch 는 no-store). **병합률이 낮아도 던지지 않는다**
 * — 목록은 유효하기 때문. 목록 자체가 비었을 때(진짜 장애)만 던진다.
 */
export async function buildCatalogRaw(): Promise<CatalogResult> {
  const list = await fetchMuseumList();
  if (list.length === 0) throw new MuseumApiFailure('EMPTY', '목록이 비어 있습니다(상류 이상).');

  const ids = list.map((r) => r.contentid?.trim()).filter((x): x is string => !!x);
  const intros = await fetchIntrosBatch(ids); // code 22 감지 시 조기 중단

  let introOk = 0;
  let noCoords = 0;
  const museums: Museum[] = [];
  for (const raw of list) {
    const cid = raw.contentid?.trim();
    const intro = cid ? intros.get(cid) ?? null : null;
    if (intro) introOk += 1;
    const m = normalizeMuseum(raw, intro);
    if (m) museums.push(m);
    else noCoords += 1;
  }

  const introCoverage = list.length ? introOk / list.length : 0;
  return { catalog: { museums, introCoverage, noCoords }, full: introCoverage >= FULL_COVERAGE };
}

interface Entry {
  ymd: string;
  expiresAt: number;
  result: CatalogResult;
}

/** 완전=자정, 부분=짧게. 어느 쪽이든 목록은 내보낸다. */
function ttlFor(full: boolean): number {
  return full ? msUntilKstMidnight() : PARTIAL_TTL_MS;
}

/* ── 인스턴스 메모리 L1(직접 빌드용, /api/catalog 가 사용) ── */
let directMem: Entry | null = null;
const directInflight = new Map<string, Promise<CatalogResult>>();

/** 직접 조립(모듈 메모리 + inflight, 조건부 TTL). /api/catalog 라우트가 호출한다. */
export async function getCatalogDirect(): Promise<CatalogResult> {
  const ymd = todayYmdKst();
  if (directMem && directMem.ymd === ymd && Date.now() < directMem.expiresAt) return directMem.result;
  const pending = directInflight.get(ymd);
  if (pending) return pending;

  const p = buildCatalogRaw()
    .then((result) => {
      directMem = { ymd, expiresAt: Date.now() + ttlFor(result.full), result };
      return result;
    })
    .finally(() => directInflight.delete(ymd));
  directInflight.set(ymd, p);
  return p;
}

/* ── 공개 라우트용: 공유 Data Cache(self-fetch) + L1(조건부 TTL) ── */
let sharedMem: Entry | null = null;
const sharedInflight = new Map<string, Promise<CatalogResult>>();

/**
 * /api/catalog self-fetch. 완전 빌드면 200 → Next Data Cache 에 자정까지(인스턴스 간 공유).
 * 부분 빌드면 /api/catalog 가 503 → Next 는 비-2xx 를 캐시하지 않으므로 공유되지 않지만, **본문의
 * 부분 카탈로그는 그대로 파싱해 목록을 살려 쓴다**(res.ok=false 여도 body 사용).
 */
async function fetchShared(): Promise<CatalogResult> {
  const url = `${selfBaseUrl()}/api/catalog`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(58_000),
    next: { revalidate: secondsUntilKstMidnight() },
  });
  const body = (await res.json()) as Catalog & { error?: string };
  if (!Array.isArray(body.museums)) throw new MuseumApiFailure('SELF_BAD', 'self-fetch 본문 이상');
  // 200=완전(공유 캐시됨), 503=부분(공유 안 됨). 어느 쪽이든 목록은 쓴다.
  return { catalog: { museums: body.museums, introCoverage: body.introCoverage, noCoords: body.noCoords }, full: res.ok };
}

/**
 * 공개 라우트가 호출. L1 → 공유 self-fetch → 폴백 직접 조립. 완전/부분에 따라 L1 TTL 을 달리해
 * 부분 빌드가 자정까지 굳지 않게 한다.
 */
export async function getCatalogCached(): Promise<Catalog> {
  const ymd = todayYmdKst();
  if (sharedMem && sharedMem.ymd === ymd && Date.now() < sharedMem.expiresAt) return sharedMem.result.catalog;
  const pending = sharedInflight.get(ymd);
  if (pending) return (await pending).catalog;

  const p = (async () => {
    let result: CatalogResult;
    try {
      result = await fetchShared();
    } catch {
      // self-fetch 경로가 막히면(로컬·URL 오설정 등) 같은 프로세스에서 직접 조립으로 폴백.
      result = await getCatalogDirect();
    }
    sharedMem = { ymd, expiresAt: Date.now() + ttlFor(result.full), result };
    return result;
  })().finally(() => sharedInflight.delete(ymd));

  sharedInflight.set(ymd, p);
  return (await p).catalog;
}
