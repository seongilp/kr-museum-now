/**
 * KST 달력 날짜 계산. (형제앱 kr-taxfree-now/lib/kst.ts 의 패턴을 그대로 옮긴 것.)
 *
 * 왜 따로 두는가: 캐시 TTL 을 "KST 자정"에서 잘라야 날짜 경계를 넘겨 하루 틀린 캐시를
 * 재사용하는 일이 구조적으로 안 생긴다. 형제앱(항공·입양)에서 인스턴트(시각 Date)와
 * 달력 날짜를 섞어 자정 경계에서 하루씩 밀린 결함을 두 번 겪었다. 그래서 여기서는
 * **KST 달력 날짜 → 에폭 일수(정수)** 로만 계산한다. 기준이 하나뿐이라 다시 어긋날 여지가 없다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

/** 지금이 KST 로 며칠인지, 1970-01-01 을 0 으로 세는 정수. */
export function kstToday(nowMs: number = Date.now()): number {
  return Math.floor((nowMs + KST_OFFSET_MS) / DAY_MS);
}

/** 에폭 일수 → `20260901`. */
export function dayToYmd(day: number): string {
  const date = new Date(day * DAY_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`;
}

/** KST 기준 오늘 `YYYYMMDD`. 서버가 UTC 로 도므로 직접 보정한다. */
export function todayYmdKst(nowMs: number = Date.now()): string {
  return dayToYmd(kstToday(nowMs));
}

/**
 * 다음 KST 자정까지 남은 밀리초. 자정 정각이면 꼬박 하루(86,400,000).
 * 캐시 수명을 이 값으로 잘라 두면 날짜 경계를 넘긴 캐시 재사용이 구조적으로 불가능해진다.
 */
export function msUntilKstMidnight(nowMs: number = Date.now()): number {
  return (kstToday(nowMs) + 1) * DAY_MS - KST_OFFSET_MS - nowMs;
}

/** 다음 KST 자정까지 남은 '초'. 항상 1 이상. CDN/Data Cache TTL 계산용. */
export function secondsUntilKstMidnight(nowMs: number = Date.now()): number {
  return Math.max(1, Math.ceil(msUntilKstMidnight(nowMs) / 1000));
}

/* ──────────────────────────────────────────────────────────────────
 * "오늘 여는가" 판정용 달력 함수. (형제앱 kr-events-now/lib/kst.ts 에서 옮김.)
 * 휴관일 판정은 인스턴트(시각)가 아니라 **KST 달력 날짜 → 에폭 일수(정수)** 위에서만
 * 돈다. 요일·서수·월을 전부 이 정수에서 뽑아 자정 경계에서 하루 밀리지 않게 한다.
 * ────────────────────────────────────────────────────────────────── */

/**
 * 에폭 일수 → 요일. 0=일 … 6=토. (1970-01-01=에폭 0=목요일, +4 보정.)
 * "박물관 오늘 휴관?" 판정의 근간이라 상태 계산과 같은 정수 기반으로 둔다(자정 안 밀림).
 */
export function dayOfWeek(day: number): number {
  return ((day % 7) + 4 + 7) % 7;
}

/**
 * 그 날이 자기 달에서 몇 번째 같은 요일인지(1~5). 예: 첫째 월요일이면 1.
 * "매월 첫째 월요일 휴관" 같은 서수 규칙 판정에 쓴다. 전부 KST 달력 기준.
 */
export function nthWeekdayOfMonth(day: number): number {
  const dom = Number(dayToYmd(day).slice(6, 8));
  return Math.floor((dom - 1) / 7) + 1;
}

/** 그 날이 자기 달에서 **마지막** 같은 요일인지(다음 주 같은 요일이 달을 넘기면 true). */
export function isLastWeekdayOfMonth(day: number): boolean {
  const ymd = dayToYmd(day);
  const nextWeek = dayToYmd(day + 7);
  return ymd.slice(0, 6) !== nextWeek.slice(0, 6);
}

/** 에폭 일수 → 월(1~12). 서수·계절 판정용. */
export function monthOf(day: number): number {
  return Number(dayToYmd(day).slice(4, 6));
}

/**
 * `20260901` → 에폭 일수. 형식이 어긋나거나 존재하지 않는 날짜면 null.
 * 자릿수만 보고 넘기면 `20260231` 이 3월 3일로 조용히 굴러가므로 되돌려 확인한다.
 * (전시 축의 시작·종료일 파싱에 쓴다.)
 */
export function ymdToDay(value: string | undefined | null): number | null {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const ms = Date.UTC(year, month - 1, day);
  if (Number.isNaN(ms)) return null;
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== year ||
    back.getUTCMonth() !== month - 1 ||
    back.getUTCDate() !== day
  ) {
    return null;
  }
  return ms / DAY_MS;
}
