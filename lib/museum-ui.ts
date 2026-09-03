import type { OpenState } from './restday';

/**
 * 개관 상태의 표시 색·배지·라벨(표시층 매핑).
 *
 * 판정 로직(restday.ts)은 open/closed/unknown 세 상태를 그대로 유지한다. 표시층에서는 사용자 지시에
 * 따라 **unknown 을 '오늘 개관(추정)'으로 매핑**한다 — 휴관일 정보가 없는 곳이 대부분이라 전부 회색으로
 * 두면 앱이 죽어 보인다. 대신 추정임을 배지 문구("방문 전 확인")와 전역 안내 한 줄로 밝힌다.
 * 휴관이 **확실한** 곳(closed)만 빨강이다.
 */

/** 표시 상태: unknown 은 '추정 개관'으로 보여준다. */
export type DisplayOpenState = 'open' | 'assumed-open' | 'closed';

export function toDisplayState(state: OpenState): DisplayOpenState {
  switch (state) {
    case 'open':
      return 'open';
    case 'closed':
      return 'closed';
    case 'unknown':
      return 'assumed-open';
  }
}

/** '오늘 여는 곳' 필터 통과 여부 — 휴관이 확실한 곳만 뺀다(unknown 은 추정 개관으로 포함). */
export function passesOpenTodayFilter(state: OpenState): boolean {
  return state !== 'closed';
}

const GREEN = '#22c55e';
const RED = '#ef4444';

/** 지도 핀 색. open 과 unknown(추정 개관) 모두 초록, closed 만 빨강. */
export const OPEN_STATE_COLOR: Record<OpenState, string> = {
  open: GREEN,
  closed: RED,
  unknown: GREEN,
};

export function openStateBadgeClass(state: OpenState): string {
  switch (toDisplayState(state)) {
    case 'open':
    case 'assumed-open':
      return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'closed':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
  }
}

export function openStateLabel(state: OpenState): string {
  switch (toDisplayState(state)) {
    case 'open':
      return '오늘 개관';
    case 'assumed-open':
      return '오늘 개관 · 방문 전 확인';
    case 'closed':
      return '오늘 휴관';
  }
}

/** 전역 안내 한 줄(목록 하단·상세 공통). 경고톤이 아니라 muted 로 조용히. */
export const OPEN_INFO_NOTICE = '휴관 정보는 일부만 반영됩니다. 실제 개관 여부는 방문 전 확인하세요.';
