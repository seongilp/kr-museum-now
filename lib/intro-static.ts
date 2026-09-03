/**
 * 정적 상세 스냅샷(`data/intros.json`) 과 인스턴스 메모리(introStore) 의 병합 규칙. **순수 함수만.**
 *
 * 왜 정적본인가: detailIntro2(휴관일 등)는 준정적인데 일일 쿼터(1,000/op)와 throttle 때문에 런타임
 * 회전만으로는 하루에 전량(≈1,680)을 못 받고, 서버리스 인스턴스 메모리라 인스턴스가 바뀌면 0% 로
 * 돌아간다. 그래서 `scripts/collect-intros.ts` 가 오프라인에서 전량을 모아 리포에 JSON 으로 넣고,
 * 런타임은 그걸 **기본**으로 쓴다. 회전 수집은 정적본에 없는 **신규 id 만** 채우고, 그 결과가 정적본
 * 위에 덮어써진다(같은 id 면 더 최신인 동적본 우선).
 *
 * lookup 규약(mergeIntros 와 동일): `undefined`=미수집 / `null`=수집됨·휴관정보 없음 / 객체=수집됨.
 */

import type { MuseumIntroRaw } from './museums';

/** 리포에 커밋되는 정적 스냅샷 파일 형식. */
export interface IntroSnapshot {
  /** 마지막 수집 실행 시각(ISO). */
  collectedAt: string;
  /** contentId → 상세 원문(필요 필드만). null = 수집됐으나 상세 항목이 비어 있음. */
  byId: Record<string, MuseumIntroRaw | null>;
  /** contentId → 그 항목을 마지막으로 받은 날(YYYY-MM-DD). --force 갱신 시 오래된 것부터 고르는 근거. */
  fetchedAt: Record<string, string>;
}

/** 비어 있는 스냅샷(정적 파일이 아직 없거나 깨졌을 때의 안전 기본값). */
export const EMPTY_SNAPSHOT: IntroSnapshot = { collectedAt: '', byId: {}, fetchedAt: {} };

/** 우리가 쓰는 detailIntro2 필드만. 스냅샷 크기·노이즈를 줄인다. */
const INTRO_FIELDS = [
  'restdateculture',
  'usetimeculture',
  'usefee',
  'parkingculture',
  'infocenterculture',
] as const satisfies readonly (keyof MuseumIntroRaw)[];

/** 상세 원문에서 필요한 필드만 뽑는다(빈 문자열은 버림). 전부 비면 빈 객체가 아니라 `{}`를 그대로 둔다. */
export function pickIntroFields(raw: Record<string, unknown> | null | undefined): MuseumIntroRaw | null {
  if (!raw) return null;
  const out: MuseumIntroRaw = {};
  for (const f of INTRO_FIELDS) {
    const v = raw[f];
    if (typeof v === 'string' && v.trim() !== '') out[f] = v;
  }
  return out;
}

/**
 * 알 수 없는 JSON 을 IntroSnapshot 으로 검증한다. 모양이 틀리면 EMPTY_SNAPSHOT(정적본 없이 동작).
 * 외부 파일은 신뢰하지 않는다 — 깨진 스냅샷이 런타임을 죽이면 안 된다.
 */
export function parseSnapshot(json: unknown): IntroSnapshot {
  const o = json as Partial<IntroSnapshot> | null;
  if (!o || typeof o !== 'object' || !o.byId || typeof o.byId !== 'object') return EMPTY_SNAPSHOT;
  const byId: Record<string, MuseumIntroRaw | null> = {};
  for (const [id, v] of Object.entries(o.byId)) {
    if (v === null) byId[id] = null;
    else if (typeof v === 'object') byId[id] = pickIntroFields(v as Record<string, unknown>);
  }
  const fetchedAt: Record<string, string> = {};
  if (o.fetchedAt && typeof o.fetchedAt === 'object') {
    for (const [id, d] of Object.entries(o.fetchedAt)) if (typeof d === 'string') fetchedAt[id] = d;
  }
  return { collectedAt: typeof o.collectedAt === 'string' ? o.collectedAt : '', byId, fetchedAt };
}

/**
 * 정적본 + 동적 저장소 → 단일 lookup. **동적본이 정적본을 덮어쓴다**(같은 id 면 회전 수집이 더 최신).
 * 어느 쪽에도 없으면 undefined(미수집) — mergeIntros 가 coverage 에서 제외한다.
 */
export function makeIntroLookup(
  snapshot: IntroSnapshot,
  dynamic: (id: string) => MuseumIntroRaw | null | undefined,
): (id: string) => MuseumIntroRaw | null | undefined {
  return (id) => {
    const d = dynamic(id);
    if (d !== undefined) return d;
    return Object.prototype.hasOwnProperty.call(snapshot.byId, id) ? snapshot.byId[id] : undefined;
  };
}

/**
 * 회전 수집 대상: 정적본에도 동적 저장소에도 없는 id 만(순서 보존). 정적본에 있는 건 쿼터를 쓰지 않는다.
 */
export function idsMissingIntro(
  ids: readonly string[],
  snapshot: IntroSnapshot,
  dynamicHas: (id: string) => boolean,
): string[] {
  return ids.filter((id) => !dynamicHas(id) && !Object.prototype.hasOwnProperty.call(snapshot.byId, id));
}

/**
 * 수집 스크립트용 대상 선정. 기본은 스냅샷에 없는 id 만; `force` 면 전량을 **가장 오래 받은 것부터**
 * (fetchedAt 없음 → 가장 오래됨) 정렬한다 — 하루 상한(≤900) 안에서 며칠에 나눠 돌려도 매번 다른 것을
 * 갱신하도록. 항상 catalog 순서를 2차 기준으로 안정 정렬.
 */
export function planCollection(
  ids: readonly string[],
  snapshot: IntroSnapshot,
  force: boolean,
): string[] {
  if (!force) return idsMissingIntro(ids, snapshot, () => false);
  const rank = (id: string) => snapshot.fetchedAt[id] ?? '';
  return ids
    .map((id, i) => ({ id, i, r: rank(id) }))
    .sort((a, b) => (a.r < b.r ? -1 : a.r > b.r ? 1 : a.i - b.i))
    .map((x) => x.id);
}

/** 스냅샷에 수집 결과를 **불변으로** 합친다(새 객체). 목록에서 사라진 id 는 그대로 둔다(보수적). */
export function withResults(
  snapshot: IntroSnapshot,
  results: ReadonlyMap<string, MuseumIntroRaw | null>,
  fetchedOn: string,
  collectedAt: string,
): IntroSnapshot {
  const byId = { ...snapshot.byId };
  const fetchedAt = { ...snapshot.fetchedAt };
  for (const [id, intro] of results) {
    byId[id] = intro;
    fetchedAt[id] = fetchedOn;
  }
  return { collectedAt, byId, fetchedAt };
}
