import type { MuseumKind } from './museums';
import { isMuseumKind } from './museums';
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

const RED = '#ef4444';

/**
 * ★ 종류별 핀·배지·칩 dot 색(단일 출처). **어두운 베이스맵 위에서 여섯이 구별되도록** 색상뿐 아니라
 * 명도까지 벌린다. 제약:
 *  - 내 위치 점(파랑 #3b82f6)과 겹치지 않게 파랑 계열 회피.
 *  - 색맹 안전: 빨강-초록 단독 대비를 피하고 명도 차를 함께 준다. 빨강은 '오늘 휴관' 링 전용.
 *  - '지금 하는 전시' 오버레이 핀(museums-map: 흰 채움+보라 링)과 채움색이 겹치지 않는다.
 *  - 기타(other)는 특징이 없으니 중립 슬레이트.
 */
export const KIND_COLOR: Record<MuseumKind, string> = {
  museum: '#f59e0b', // 앰버 — 가장 많고 대표적
  gallery: '#f472b6', // 로즈
  exhibition: '#a855f7', // 바이올렛
  memorial: '#2dd4bf', // 틸
  science: '#a3e635', // 라임 — 희소(59)라 밝게 눈에 띄게
  other: '#94a3b8', // 슬레이트(중립, fallback)
};

/** 종류 색. 알 수 없는 값(외부 데이터·구버전 캐시)은 기타색으로 — 절대 throw 하지 않는다. */
export function kindColorFor(kind: MuseumKind | string | null | undefined): string {
  return isMuseumKind(kind) ? KIND_COLOR[kind] : KIND_COLOR.other;
}

/**
 * '오늘 휴관(확정)' 핀 표현 — 색이 아니라 **흐림 + 빨간 링**으로. 종류색은 유지한 채 구분한다
 * (빨강을 채움색으로 쓰면 종류색과 충돌하고, 색맹 사용자에겐 초록·빨강 대비가 안 읽힌다).
 * open·unknown(추정 개관)은 종류색 그대로.
 */
export const CLOSED_RING_COLOR = RED;
export const CLOSED_PIN_OPACITY = 0.4;
export const OPEN_PIN_OPACITY = 0.92;

/** 상태별 핀 채움 투명도. closed 만 흐리게. */
export function pinOpacityFor(state: OpenState): number {
  return state === 'closed' ? CLOSED_PIN_OPACITY : OPEN_PIN_OPACITY;
}

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
