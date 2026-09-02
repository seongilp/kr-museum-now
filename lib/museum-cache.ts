/**
 * 박물관 카탈로그(목록 + 상세 병합, 정규화 완료) 캐시. 이 앱 쿼터·성능·정직성 방어의 핵심이다.
 *
 * ── 규모와 제약 ──
 * lclsSystm3 로 거른 박물관류가 **≈1,680건**이다. 그런데 detailIntro2(휴관일 등 상세)는
 *   (a) 일일 쿼터 1,000/op,  (b) 토큰버킷 throttle 로 pacer 55s당 ~680건이 한계
 * 라 **하루에 전량을 못 받는다.**
 *
 * ── 해법: 목록/상세 결합 해제 + 상세 회전 수집(rotation) ──
 *  - **목록(areaBasedList2)** 은 1콜로 전량(≈1,680) 받아 **항상** 지도·이름·좌표를 내보낸다.
 *    상세가 없어도 목록은 산다(국립중앙박물관이 빠지는 일 없음).
 *  - **상세(detailIntro2)** 는 준정적(휴관일 원문은 매일 안 바뀜)이라 **인스턴스 메모리에 며칠
 *    누적**(introStore, TTL 3일)하고, 매 빌드마다 아직 없는 것부터 **일일 상한(DAILY_DETAIL_CAP)**
 *    까지만 회전 수집한다. 며칠에 걸쳐 전량 커버. 미수집분은 restRaw=null → 라우트가 openToday
 *    를 unknown 으로 두고 **개수를 고지**한다(결측을 값인 척 금지).
 *  - "오늘 여는가" 판정은 restRaw + KST '오늘' 로 라우트가 매 요청 계산(준정적 원문 → 매일 재판정).
 *
 * ── 2층 캐시 ──
 *  1) 조립 결과를 `/api/catalog` self-fetch(`next:{revalidate}`)로 인스턴스 간 공유(완전=자정,
 *     부분=짧게). 대부분의 인스턴스는 이 공유본을 읽기만 해 상류를 안 때린다.
 *  2) 빌드하는 인스턴스만 introStore 에 누적. 목록 자체가 비면(진짜 장애) 그때만 던진다.
 *
 * ── 쿼터 회계 ──
 * detailIntro2 시작 요청 수를 KST 하루 단위로 세어 DAILY_DETAIL_CAP 에서 멈춘다(< 1,000). 부분
 * 빌드는 짧게만 캐시해 상한 소진 전까지 다음 빌드가 회전을 이어가게 한다.
 */

import { fetchIntrosBatch, fetchMuseumList, MuseumApiFailure, type IntrosBatchResult } from './museum-api';
import { normalizeMuseum, type Museum, type MuseumIntroRaw } from './museums';
import { msUntilKstMidnight, secondsUntilKstMidnight, todayYmdKst } from './kst';
import { selfBaseUrl } from './self';

/** detailIntro2 일일 상한(쿼터 1,000 에 areaBasedList2·안전마진 남김). 회전 수집의 하루 예산. */
const DAILY_DETAIL_CAP = 900;
/** 상세 원문(준정적) 메모리 보존 기간. 이 안엔 재수집 안 함(회전 예산 절약). */
const INTRO_TTL_MS = 3 * 24 * 60 * 60 * 1000;
/** 부분 빌드(회전 진행 중)의 짧은 캐시 수명 — 상한 전까지 다음 빌드가 이어받게. */
const PARTIAL_TTL_MS = 12 * 60 * 1000;

/** 전량 카탈로그(정규화 완료). introCoverage 로 "오늘 여는가" 판정 신뢰도를 노출한다. */
export interface Catalog {
  museums: Museum[];
  introCoverage: number;
  noCoords: number;
}

export interface CatalogResult {
  catalog: Catalog;
  full: boolean;
}

/* ── 상세 원문 누적 저장소(회전 수집의 심장) ── */
interface IntroEntry {
  intro: MuseumIntroRaw | null;
  at: number;
}
const introStore = new Map<string, IntroEntry>();
/** KST 하루 단위 detailIntro2 요청 회계. */
let detailBudget = { ymd: '', attempted: 0 };

function pruneIntroStore(now: number): void {
  for (const [k, v] of introStore) if (now - v.at > INTRO_TTL_MS) introStore.delete(k);
}

/**
 * 원본 수집 → 회전 상세 수집 → 조립. 목록은 항상 살린다. 목록 자체가 비면 던진다.
 * full = 이번 빌드 뒤에도 미수집이 하나도 없음(= 전량 커버).
 */
export async function buildCatalogRaw(): Promise<CatalogResult> {
  const list = await fetchMuseumList();
  if (list.length === 0) throw new MuseumApiFailure('EMPTY', '목록이 비어 있습니다(상류 이상).');

  const now = Date.now();
  pruneIntroStore(now);

  const ids = list.map((r) => r.contentid?.trim()).filter((x): x is string => !!x);
  const uncovered = ids.filter((id) => !introStore.has(id));

  // 일일 예산 회전 수집.
  const today = todayYmdKst(now);
  if (detailBudget.ymd !== today) detailBudget = { ymd: today, attempted: 0 };
  const remaining = Math.max(0, DAILY_DETAIL_CAP - detailBudget.attempted);
  const toFetch = uncovered.slice(0, remaining);

  if (toFetch.length > 0) {
    const batch: IntrosBatchResult = await fetchIntrosBatch(toFetch);
    detailBudget.attempted += batch.attempted;
    for (const [id, intro] of batch.results) introStore.set(id, { intro, at: now });
  }

  // 조립: 목록 전건 + 누적된 상세.
  let introOk = 0;
  let noCoords = 0;
  const museums: Museum[] = [];
  for (const raw of list) {
    const cid = raw.contentid?.trim();
    const intro = cid ? introStore.get(cid)?.intro ?? null : null;
    if (intro) introOk += 1;
    const m = normalizeMuseum(raw, intro);
    if (m) museums.push(m);
    else noCoords += 1;
  }

  const introCoverage = list.length ? introOk / list.length : 0;
  const stillUncovered = ids.filter((id) => !introStore.has(id)).length;
  return { catalog: { museums, introCoverage, noCoords }, full: stillUncovered === 0 };
}

interface Entry {
  ymd: string;
  expiresAt: number;
  result: CatalogResult;
}

/** 완전=자정, 부분=짧게(회전 진행 지속). */
function ttlFor(full: boolean): number {
  return full ? msUntilKstMidnight() : PARTIAL_TTL_MS;
}

/* ── 인스턴스 메모리 L1(직접 빌드용, /api/catalog 가 사용) ── */
let directMem: Entry | null = null;
const directInflight = new Map<string, Promise<CatalogResult>>();

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
  return {
    catalog: { museums: body.museums, introCoverage: body.introCoverage, noCoords: body.noCoords },
    full: res.ok,
  };
}

/**
 * 공개 라우트가 호출. L1 → 공유 self-fetch → 폴백 직접 조립. 완전/부분에 따라 TTL 을 달리해
 * 부분(회전 진행)일 땐 짧게 캐시하고, 목록 자체 실패(EMPTY)만 예외로 전파한다.
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
      result = await getCatalogDirect(); // self-fetch 막히면 같은 프로세스에서 조립(EMPTY 면 전파)
    }
    sharedMem = { ymd, expiresAt: Date.now() + ttlFor(result.full), result };
    return result;
  })().finally(() => sharedInflight.delete(ymd));

  sharedInflight.set(ymd, p);
  return (await p).catalog;
}
