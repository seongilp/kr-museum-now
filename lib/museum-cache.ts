/**
 * 박물관 카탈로그 캐시. 이 앱 쿼터·성능·정직성 방어의 핵심이다.
 *
 * ── 규모와 제약 ──
 * lclsSystm3 로 거른 박물관류가 **≈1,680건**이다. 그런데 detailIntro2(휴관일 등 상세)는
 *   (a) 일일 쿼터 1,000/op,  (b) 토큰버킷 throttle 로 pacer 80ms당 ~680건이 한계
 * 라 **하루에 전량을 못 받는다.**
 *
 * ── ★ 목록/상세를 캐시 경로에서도 완전히 분리한다(콜드 로딩 방어) ──
 * 예전엔 목록 요청 하나가 조립(목록+상세 회전)까지 통째로 밟아, 콜드 인스턴스에서 상세 회전(pacer
 * 80ms × 최대 900, BUDGET_MS 55s)이 **목록 응답을 55초까지 붙잡았다.** 게다가 부분 빌드는 503 이라
 * Next Data Cache 가 공유하지 않아 **콜드 인스턴스마다 55초 회전을 반복**했다("박물관 불러오는 중…"
 * 오래 멈춤의 정체). 그래서 지금은:
 *
 *  1) **목록(list)** — areaBasedList2 1콜(≈1s)로 좌표·이름·종류·시도를 정규화한다. 상세는 붙이지
 *     않는다. 목록 자체가 성공하면 **항상 200** 으로 self-fetch(`/api/catalog`) Data Cache 에 태워
 *     인스턴스 간 공유한다(자정까지). → **콜드 인스턴스도 <1s 로 목록을 받는다.** 절대 목록 응답이
 *     상세 회전을 기다리지 않는다.
 *  2) **상세(intro)** — 준정적(휴관일 원문은 매일 안 바뀜)이라 **인스턴스 메모리(introStore, TTL 3일)**
 *     에 누적한다. 회전 수집(rotation)은 **요청 경로 밖에서만** 돈다:
 *       (a) `/api/warm` 크론(하루 1회) 가 `runIntroRotation()` 을 직접 호출,
 *       (b) 공개 목록 응답을 내보낸 뒤 `after()` 로 **백그라운드 회전 킥**(그 인스턴스 self-heal).
 *     둘 다 일일 상한(DAILY_DETAIL_CAP)·시간예산·code22 로 스스로 멈춘다. 며칠에 걸쳐 전량 커버.
 *  3) 목록 응답 시점에 **그 인스턴스에 쌓인 상세만 병합**(mergeIntros)한다 — "있는 만큼" 정직하게.
 *     미수집분은 restRaw=null → 라우트가 openToday 를 unknown 으로 두고 introCoverage 로 고지한다.
 *
 * ── 쿼터 회계 ──
 * detailIntro2 시작 요청 수를 KST 하루 단위로 세어 DAILY_DETAIL_CAP 에서 멈춘다(< 1,000). 회전은
 * 인스턴스당 한 번에 하나만 돌고(rotationInflight), 하루치 커버 완료·쿼터 소진 시 그날 회전을
 * 접는다(rotationDone) — 백그라운드 킥이 빈 회전을 반복하지 않게.
 */

import { fetchIntrosBatch, fetchMuseumList, MuseumApiFailure, type IntrosBatchResult } from './museum-api';
import { mergeIntros, normalizeMuseum, type Museum, type MuseumIntroRaw } from './museums';
import { msUntilKstMidnight, secondsUntilKstMidnight, todayYmdKst } from './kst';
import { selfBaseUrl } from './self';

/** detailIntro2 일일 상한(쿼터 1,000 에 areaBasedList2·안전마진 남김). 회전 수집의 하루 예산. */
const DAILY_DETAIL_CAP = 900;
/** 상세 원문(준정적) 메모리 보존 기간. 이 안엔 재수집 안 함(회전 예산 절약). */
const INTRO_TTL_MS = 3 * 24 * 60 * 60 * 1000;

/** 목록 카탈로그(정규화 완료, 상세 미병합). 항상 200 으로 공유되는 빠른 기반. */
export interface ListCatalog {
  museums: Museum[];
  noCoords: number;
}

/** 공개 카탈로그(목록 + 그 인스턴스에 쌓인 상세 병합). introCoverage 로 판정 신뢰도를 노출한다. */
export interface Catalog {
  museums: Museum[];
  introCoverage: number;
  noCoords: number;
}

/** 회전 수집 결과(warm 리포팅·백그라운드 킥 판단용). */
export interface RotationResult {
  attempted: number;
  covered: number;
  total: number;
  coverage: number;
  quotaHit: boolean;
  budgetRemaining: number;
}

/* ── 상세 원문 누적 저장소(회전 수집의 심장) ── */
interface IntroEntry {
  intro: MuseumIntroRaw | null;
  at: number;
}
const introStore = new Map<string, IntroEntry>();
/** KST 하루 단위 detailIntro2 요청 회계. */
let detailBudget = { ymd: '', attempted: 0 };
/** 그날 회전을 접었는가(전량 커버·쿼터 소진·예산 소진). 백그라운드 킥의 빈 반복 방지. */
let rotationDone = { ymd: '', done: false };

function pruneIntroStore(now: number): void {
  for (const [k, v] of introStore) if (now - v.at > INTRO_TTL_MS) introStore.delete(k);
}

function ensureToday(now: number): string {
  const today = todayYmdKst(now);
  if (detailBudget.ymd !== today) detailBudget = { ymd: today, attempted: 0 };
  if (rotationDone.ymd !== today) rotationDone = { ymd: today, done: false };
  return today;
}

/* ────────────────────────────────────────────────────────────────
 * 1) 목록 카탈로그 — 빠르고 항상 200, 인스턴스 간 공유
 * ──────────────────────────────────────────────────────────────── */

/** areaBasedList2 1콜 → 정규화(상세 미병합). 목록이 비면(진짜 장애) 던진다. */
export async function buildListCatalog(): Promise<ListCatalog> {
  const list = await fetchMuseumList();
  if (list.length === 0) throw new MuseumApiFailure('EMPTY', '목록이 비어 있습니다(상류 이상).');
  let noCoords = 0;
  const museums: Museum[] = [];
  for (const raw of list) {
    const m = normalizeMuseum(raw, null); // 상세는 요청 시점에 mergeIntros 로 병합
    if (m) museums.push(m);
    else noCoords += 1;
  }
  return { museums, noCoords };
}

interface ListEntry {
  ymd: string;
  expiresAt: number;
  catalog: ListCatalog;
}

/* L1(인스턴스 메모리): /api/catalog 가 사용. 목록은 하루 안정적이라 TTL=자정. */
let listDirectMem: ListEntry | null = null;
const listDirectInflight = new Map<string, Promise<ListCatalog>>();

/** /api/catalog 가 호출: 직접 빌드 + L1. 목록만이라 빠르고, EMPTY 만 예외로 전파. */
export async function getListCatalogDirect(): Promise<ListCatalog> {
  const ymd = todayYmdKst();
  if (listDirectMem && listDirectMem.ymd === ymd && Date.now() < listDirectMem.expiresAt) {
    return listDirectMem.catalog;
  }
  const pending = listDirectInflight.get(ymd);
  if (pending) return pending;

  const p = buildListCatalog()
    .then((catalog) => {
      listDirectMem = { ymd, expiresAt: Date.now() + msUntilKstMidnight(), catalog };
      return catalog;
    })
    .finally(() => listDirectInflight.delete(ymd));
  listDirectInflight.set(ymd, p);
  return p;
}

/* 공개 라우트용: 공유 Data Cache(self-fetch) + L1(자정 TTL). */
let listSharedMem: ListEntry | null = null;
const listSharedInflight = new Map<string, Promise<ListCatalog>>();

async function fetchSharedList(): Promise<ListCatalog> {
  const url = `${selfBaseUrl()}/api/catalog`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000), // 목록만이라 짧게. 상세 회전을 안 기다린다.
    next: { revalidate: secondsUntilKstMidnight() },
  });
  const body = (await res.json()) as ListCatalog & { error?: string };
  if (!res.ok || !Array.isArray(body.museums) || body.museums.length === 0) {
    throw new MuseumApiFailure('SELF_BAD', 'self-fetch 목록 본문 이상');
  }
  return { museums: body.museums, noCoords: body.noCoords ?? 0 };
}

/** 공개 라우트가 사용하는 목록: L1 → 공유 self-fetch → 폴백 직접 빌드. 항상 200 경로라 공유된다. */
async function getListCatalogShared(): Promise<ListCatalog> {
  const ymd = todayYmdKst();
  if (listSharedMem && listSharedMem.ymd === ymd && Date.now() < listSharedMem.expiresAt) {
    return listSharedMem.catalog;
  }
  const pending = listSharedInflight.get(ymd);
  if (pending) return pending;

  const p = (async () => {
    let catalog: ListCatalog;
    try {
      catalog = await fetchSharedList();
    } catch {
      catalog = await getListCatalogDirect(); // self-fetch 막히면 같은 프로세스에서 빌드(EMPTY 면 전파)
    }
    listSharedMem = { ymd, expiresAt: Date.now() + msUntilKstMidnight(), catalog };
    return catalog;
  })().finally(() => listSharedInflight.delete(ymd));

  listSharedInflight.set(ymd, p);
  return p;
}

/* ────────────────────────────────────────────────────────────────
 * 2) 상세 회전 수집 — 요청 경로 밖에서만(warm 크론 + 백그라운드 킥)
 * ──────────────────────────────────────────────────────────────── */

let rotationInflight: Promise<RotationResult> | null = null;

async function doRotation(): Promise<RotationResult> {
  const list = await fetchMuseumList();
  const now = Date.now();
  pruneIntroStore(now);
  ensureToday(now);

  const ids = list.map((r) => r.contentid?.trim()).filter((x): x is string => !!x);
  const remaining = Math.max(0, DAILY_DETAIL_CAP - detailBudget.attempted);
  const uncovered = ids.filter((id) => !introStore.has(id));
  const toFetch = uncovered.slice(0, remaining);

  let quotaHit = false;
  let attempted = 0; // 실제로 상류에 시작한 요청 수(예산 소비분). toFetch.length 가 아니라 이것.
  if (toFetch.length > 0) {
    const batch: IntrosBatchResult = await fetchIntrosBatch(toFetch);
    attempted = batch.attempted;
    detailBudget.attempted += batch.attempted;
    for (const [id, intro] of batch.results) introStore.set(id, { intro, at: now });
    quotaHit = batch.quotaHit;
  }

  const covered = ids.filter((id) => introStore.has(id)).length;
  const budgetRemaining = Math.max(0, DAILY_DETAIL_CAP - detailBudget.attempted);
  // 그날 회전을 접을 조건: 전량 커버 / 쿼터 소진 / 예산 소진.
  if (covered >= ids.length || quotaHit || budgetRemaining === 0) rotationDone.done = true;

  return {
    attempted,
    covered,
    total: ids.length,
    coverage: ids.length ? covered / ids.length : 0,
    quotaHit,
    budgetRemaining,
  };
}

/**
 * 상세 회전 수집을 1회 돌린다. 인스턴스당 동시 1개만(중복 킥 흡수). warm 크론과 백그라운드 킥이 호출.
 * 절대 목록·공개 응답 경로에서 await 하지 않는다.
 */
export function runIntroRotation(): Promise<RotationResult> {
  if (rotationInflight) return rotationInflight;
  rotationInflight = doRotation().finally(() => {
    rotationInflight = null;
  });
  return rotationInflight;
}

/**
 * 오늘 더 돌릴 회전이 남았는가(백그라운드 킥 게이트). 접었으면(전량 커버·쿼터·예산 소진) false.
 * 공개 목록 응답 뒤 `after()` 콜백이 이걸 보고 회전을 이어 돌릴지 정한다.
 */
export function rotationPending(): boolean {
  const today = todayYmdKst();
  if (rotationDone.ymd === today && rotationDone.done) return false;
  const attempted = detailBudget.ymd === today ? detailBudget.attempted : 0;
  return DAILY_DETAIL_CAP - attempted > 0;
}

/* ────────────────────────────────────────────────────────────────
 * 3) 공개 카탈로그 = 목록(빠름·공유) + 그 인스턴스에 쌓인 상세 병합(있는 만큼)
 * ──────────────────────────────────────────────────────────────── */

/** 공개 라우트가 호출. 목록은 즉시(공유 캐시), 상세는 introStore 에서 병합. 회전을 절대 안 기다린다. */
export async function getCatalogCached(): Promise<Catalog> {
  const list = await getListCatalogShared();
  const { museums, introCoverage } = mergeIntros(list.museums, (id) =>
    introStore.has(id) ? (introStore.get(id)?.intro ?? null) : undefined,
  );
  return { museums, introCoverage, noCoords: list.noCoords };
}
