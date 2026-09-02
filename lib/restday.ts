/**
 * 휴관일(restdateculture) 자연어 → "오늘 여는가" 판정. **순수 함수만**(테스트가 여기 붙는다).
 *
 * ★ 이 파일이 이 앱의 성패다. 원칙(팀 지시):
 *  1) 확실히 파싱되는 것만 판정한다 — 주간 요일 반복("매주 월요일"류)·서수(매월 N째 주 요일)·연중무휴.
 *  2) **파싱 실패를 '열림'으로 처리하지 않는다.** open / closed / unknown 세 상태를 명확히 나눈다.
 *  3) 원문을 항상 함께 보여준다(이 함수는 판정만; UI가 원문을 같이 렌더).
 *  4) 판정 불가(unknown)를 조용히 숨기지 않는다(화면에서 따로 표시·집계).
 *  5) 공휴일 예외까지는 계산하지 않는다(캘린더 없음) — 공휴일/명절 문구는 '소프트'로 보고
 *     전역 고지문으로 덮되, open 판정을 막지 않는다(막으면 커버리지가 붕괴한다).
 *
 * ── 국문 전용 설계(형제 다국어판과 결정적으로 다른 점) ──
 * kr-events-now 의 restday.ts 는 외국어 서비스(영/일/중)를 파싱했다. 이 앱은 국문
 * KorService2 라 restdateculture 가 **한국어**다("매주 월요일" / "연중무휴" / "1월 1일,
 * 설날, 추석 당일"). 그래서 한글 요일·서수·명절 문구를 처음부터 다시 짰다. 실측 예시:
 *   "매주 월요일"                             → 월요일 휴관
 *   "매주 월요일(월요일이 공휴일인 경우 그 다음날)" → 월 휴관 + 공휴일 예외(소프트)
 *   "매월 첫째, 셋째 주 월요일"                 → 서수(1·3주 월요일)
 *   "1월 1일, 설날 및 추석 당일"                → 명절만 휴관(주간 없음) → 오늘은 개관
 *   "연중무휴" / "없음"                         → 연중 개관
 *   "전시 준비기간, 홈페이지 참조"              → 판정 불가(unknown)
 */

import { dayOfWeek, isLastWeekdayOfMonth, monthOf, nthWeekdayOfMonth } from './kst';

export type OpenState = 'open' | 'closed' | 'unknown';

export interface Closure {
  /** 매주 쉬는 요일들(0=일 … 6=토). */
  weekly: number[];
  /** 연중무휴 문구가 잡혔는가. */
  openAllYear: boolean;
  /** 서수(매월 N번째 요일) 규칙들. 오늘 계산에 쓴다. */
  ordinals: Ordinal[];
  /** 평가 불가한 절이 있는가(계절 정기휴관·전시준비·별도공지·요일 범위 등). */
  hard: boolean;
  /** 공휴일/명절 등 '소프트' 절이 있는가(전역 고지문 대상). */
  holidayCaveat: boolean;
}

interface Ordinal {
  weekday: number;
  /** 1~5 또는 'last'. */
  nth: number | 'last';
  /** 특정 달로 한정되면 그 달들(1~12). null 이면 매월. */
  months: number[] | null;
}

/** 한글 요일 문자 → 인덱스(0=일 … 6=토). */
const KO_WD: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/** 서수 한글 표현 → 숫자('last' 포함). */
const ORD_WORD: Record<string, number | 'last'> = {
  첫째: 1, 첫번째: 1, 첫: 1, 둘째: 2, 두번째: 2, 셋째: 3, 세번째: 3,
  넷째: 4, 네번째: 4, 다섯째: 5, 다섯번째: 5, 마지막: 'last', 말일: 'last', 끝: 'last',
};

/* ── 정규화: 태그 제거, 공백 정리 ── */
function normalize(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 요일 인덱스 목록에서 중복 제거·정렬. */
const uniq = (xs: number[]): number[] => [...new Set(xs)].sort((a, b) => a - b);

/* ── 연중무휴(= 휴관일 없음 = 오늘도 개관) ──
   restdateculture 가 "없음"/"연중무휴"/"휴관일 없음"/"무휴"/"연중개관" 계열이면 개관. */
const OPEN_ALL_YEAR = /(연중\s*무휴|연중\s*개관|연중\s*운영|무휴|휴관일?\s*없|휴무일?\s*없|없음)/;

/* ── 하드(평가 불가) 절: 계절·전시준비·기상·별도공지 등 오늘 여부를 알 수 없는 문구 ──
   이게 걸리면 다른 게 파싱돼도 unknown 으로 내린다("오늘 적용될지 모른다"를 정직하게). */
const HARD_CLAUSE =
  /(전시\s*준비|전시\s*교체|전시\s*변경|전시\s*설치|재정비|정비\s*기간|정비\s*중|점검|보수|공사|동절기|하절기|계절|기상|우천|사정에\s*따라|별도\s*공지|홈페이지\s*(참조|참고|확인)|공지\s*(참조|참고|확인)|기관에?\s*문의|상이|변동|비정기|부정기|수시)/;

/* ── 소프트(공휴일/명절) 절: 오늘이 공휴일인지 캘린더가 없어 못 따지므로 전역 고지문으로 덮는다 ── */
const HOLIDAY_CLAUSE =
  /(공휴일|국경일|대체\s*공휴일|명절|설날|설\s|구정|신정|추석|한가위|정월|1월\s*1일|1\.1|근로자의\s*날|어린이날|성탄절|크리스마스)/;

/**
 * 서수(매월 N째 주 요일) 규칙을 원문에서 뽑아내고, 그 요일 언급을 주간 파서가 삼키지 않도록
 * **잘라낸** 나머지 문자열을 함께 돌려준다. 잘라내지 않으면 "매월 첫째 주 월요일"의 '월요일'이
 * "매주 월요일"로 오독된다(최악의 함정). 한글 실측 형태:
 *   "매월 첫째, 셋째 주 월요일" / "매달 둘째·넷째 주 화요일" / "매월 마지막 주 월요일" / "셋째주 수요일"
 */
function extractOrdinals(s: string): { ordinals: Ordinal[]; rest: string } {
  const ordinals: Ordinal[] = [];
  // 서수어(첫째/둘째/…/마지막) 하나 이상이 구분자로 이어지고, (주/째주) 뒤 요일이 온다.
  const ordWord = '(?:첫번째|첫째|첫|두번째|둘째|세번째|셋째|네번째|넷째|다섯번째|다섯째|마지막|말일|끝)';
  const re = new RegExp(
    `((?:${ordWord})(?:\\s*[,·./、및와과]\\s*(?:${ordWord}))*)\\s*(?:주|주차|째\\s*주)?\\s*([일월화수목금토])\\s*요일`,
    'g',
  );
  const rest = s.replace(re, (_m, ords: string, wd: string) => {
    const weekday = KO_WD[wd];
    for (const om of ords.matchAll(
      /첫번째|첫째|첫|두번째|둘째|세번째|셋째|네번째|넷째|다섯번째|다섯째|마지막|말일|끝/g,
    )) {
      const nth = ORD_WORD[om[0]];
      if (nth != null) ordinals.push({ weekday, nth, months: null });
    }
    return ' ';
  });

  // 숫자 서수: "매월 1,3주 월요일" / "2·4주 화요일"
  const reNum = /((?:\d\s*[,·./、]\s*)*\d)\s*(?:째\s*)?주\s*([일월화수목금토])\s*요일/g;
  const rest2 = rest.replace(reNum, (_m, nums: string, wd: string) => {
    const weekday = KO_WD[wd];
    for (const nm of nums.matchAll(/\d/g)) {
      const n = Number(nm[0]);
      if (n >= 1 && n <= 5) ordinals.push({ weekday, nth: n, months: null });
    }
    return ' ';
  });

  return { ordinals, rest: rest2 };
}

/**
 * 정규화된(서수 제거된) 문자열에서 '매주 쉬는 요일' 집합을 파싱.
 * 한글 요일 런("월", "월,화", "월·화·수")이 요일로 끝나면 그 안의 요일 문자를 전부 모은다.
 * "주말"=토·일, "평일"=월~금 도 처리. 요일 사이 범위("화~목요일")는 여기서 처리하지 않고
 * hard 로 넘긴다(닫힌-요일 필드에서 범위는 드물고 방향이 모호해 억측하지 않는다).
 */
function parseWeekly(s: string): number[] {
  const days: number[] = [];
  if (/주말/.test(s)) days.push(0, 6);
  if (/평일/.test(s)) days.push(1, 2, 3, 4, 5);

  // 요일 런 + 요일: "월", "월,화", "월·화·수" 뒤에 '요일'. 각 요일 문자를 수집.
  const runRe = /([일월화수목금토](?:\s*[,·./、및와과]\s*[일월화수목금토])*)\s*요일/g;
  for (const m of s.matchAll(runRe)) {
    for (const c of m[1].matchAll(/[일월화수목금토]/g)) days.push(KO_WD[c[0]]);
  }
  return uniq(days);
}

/** 요일 범위("화~일요일")가 있으면 방향이 모호해 unknown 으로 넘긴다. */
const WEEKDAY_RANGE = /[일월화수목금토]\s*(?:요일)?\s*[~〜–\-]\s*[일월화수목금토]\s*요일/;

/** 원문 → 파싱된 휴무 구조. */
export function parseClosure(raw: string | null | undefined): Closure {
  const empty: Closure = { weekly: [], openAllYear: false, ordinals: [], hard: false, holidayCaveat: false };
  if (!raw) return empty;
  const s = normalize(raw);
  if (!s) return empty;

  const openAllYear = OPEN_ALL_YEAR.test(s);
  const { ordinals, rest } = extractOrdinals(s);
  const weekly = parseWeekly(rest);
  const hard = HARD_CLAUSE.test(rest) || WEEKDAY_RANGE.test(rest);
  const holidayCaveat = HOLIDAY_CLAUSE.test(s);

  return { weekly, openAllYear, ordinals, hard, holidayCaveat };
}

/** 서수 규칙이 '오늘' 문을 닫는가. */
function ordinalHitsToday(o: Ordinal, epochDay: number): boolean {
  const dow = dayOfWeek(epochDay);
  if (o.weekday !== dow) return false; // 오늘이 그 요일이 아니면 무관
  if (o.months && !o.months.includes(monthOf(epochDay))) return false;
  if (o.nth === 'last') return isLastWeekdayOfMonth(epochDay);
  return nthWeekdayOfMonth(epochDay) === o.nth;
}

/**
 * 오늘(KST 에폭 일수) 기준 개관 여부. 세 상태를 정직하게 구분한다.
 */
export function verdictFor(closure: Closure, epochDay: number): OpenState {
  const dow = dayOfWeek(epochDay);

  // 1) 매주 쉬는 요일에 해당 → 확실히 휴관.
  if (closure.weekly.includes(dow)) return 'closed';

  // 2) 서수 규칙이 오늘을 닫으면 휴관.
  for (const o of closure.ordinals) {
    if (ordinalHitsToday(o, epochDay)) return 'closed';
  }

  // 3) 평가 불가한 하드 절이 있으면 오늘 적용될지 알 수 없음 → unknown(요일 규칙을 넘어선다).
  if (closure.hard) return 'unknown';

  // 4) 연중무휴이거나 주간/서수 요일 규칙을 이해했으면 → 오늘은 (주간) 휴무일이 아님 = 개관.
  if (closure.openAllYear || closure.weekly.length > 0 || closure.ordinals.length > 0) return 'open';

  // 5) 주간 규칙은 없지만 '공휴일/명절에만 휴관'으로 온전히 읽힌 경우 → 오늘은 개관으로 본다.
  //    오늘이 실제 공휴일인지까지는 확인하지 않으므로(캘린더 없음) 전역 고지문으로 한계를 덮는다.
  if (closure.holidayCaveat) return 'open';

  // 6) 아무 것도 해석 못 함(예: "무(웹공지)") → 판정 불가.
  return 'unknown';
}

/** 원문 + 오늘 → 판정 한 방에. */
export function openTodayState(raw: string | null | undefined, epochDay: number): OpenState {
  return verdictFor(parseClosure(raw), epochDay);
}
