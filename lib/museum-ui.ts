import type { OpenState } from './restday';

/**
 * 개관 상태의 표시 색·배지·라벨. 세 상태(open/closed/unknown)를 **명확히 다른 색**으로 구분한다 —
 * "판정 불가"를 초록(개관)처럼 보이게 하면 이 프로젝트 최악의 반복 결함(결측을 값인 척)을
 * 되풀이하게 된다. unknown 은 중립 회색으로, 초록/빨강 어느 쪽과도 안 헷갈리게.
 */
export const OPEN_STATE_COLOR: Record<OpenState, string> = {
  open: '#22c55e', // 개관 — 초록
  closed: '#ef4444', // 휴관 — 빨강
  unknown: '#9ca3af', // 판정 불가 — 회색
};

export function openStateBadgeClass(state: OpenState): string {
  switch (state) {
    case 'open':
      return 'bg-green-500/15 text-green-400 border-green-500/30';
    case 'closed':
      return 'bg-red-500/15 text-red-400 border-red-500/30';
    case 'unknown':
      return 'bg-gray-500/15 text-gray-300 border-gray-500/30';
  }
}

export function openStateLabel(state: OpenState): string {
  switch (state) {
    case 'open':
      return '오늘 개관';
    case 'closed':
      return '오늘 휴관';
    case 'unknown':
      return '휴관 정보 확인 필요';
  }
}
