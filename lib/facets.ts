/**
 * 필터 — 이 앱의 discovery UX. **순수 함수**(테스트가 붙는다).
 *
 * 세 축:
 *  1) 종류(kind): 박물관·미술관·전시관·기념관. 다중 선택(여러 개 켜면 합집합). cat3 로 확정된 값이라
 *     채움률 100% — 필터로 안전하다.
 *  2) 지역(sido): 시도 단일 선택. areacode 로 확정.
 *  3) **오늘 여는 곳(openTodayOnly)**: 이 앱의 킬러. 휴관일 원문 → restday.ts 판정이 'open' 인 곳만.
 *     'closed'/'unknown' 은 제외되며, **몇 곳이 제외됐는지 화면에 밝힌다**(조용히 숨기지 않는다).
 *     이 판정은 KST '오늘'에 의존하므로 필터 자체는 서버 라우트에서 적용한다(여기서는 종류·지역만).
 *
 * 결합 규칙: 축 사이는 AND. 종류 축 안은 OR(합집합).
 */

import type { Museum, MuseumKind } from './museums';
import { KIND_LABEL } from './museums';

export interface KindOption {
  key: MuseumKind;
  label: string;
}

export const KIND_OPTIONS: KindOption[] = [
  { key: 'museum', label: KIND_LABEL.museum },
  { key: 'gallery', label: KIND_LABEL.gallery },
  { key: 'exhibition', label: KIND_LABEL.exhibition },
  { key: 'memorial', label: KIND_LABEL.memorial },
];

/**
 * 시도(도/광역시) 옵션. key 는 museums.ts 의 areacode 매핑과 1:1. center 는 지도 이동용 대략
 * 중심좌표(WGS84). 순서는 대체로 인구·방문 규모.
 */
export interface SidoOption {
  key: string;
  label: string;
  center: { lat: number; lon: number };
}

export const SIDO_OPTIONS: SidoOption[] = [
  { key: 'seoul', label: '서울', center: { lat: 37.5665, lon: 126.978 } },
  { key: 'gyeonggi', label: '경기', center: { lat: 37.41, lon: 127.52 } },
  { key: 'incheon', label: '인천', center: { lat: 37.45, lon: 126.6 } },
  { key: 'busan', label: '부산', center: { lat: 35.18, lon: 129.07 } },
  { key: 'daegu', label: '대구', center: { lat: 35.87, lon: 128.6 } },
  { key: 'daejeon', label: '대전', center: { lat: 36.35, lon: 127.38 } },
  { key: 'gwangju', label: '광주', center: { lat: 35.16, lon: 126.85 } },
  { key: 'ulsan', label: '울산', center: { lat: 35.54, lon: 129.31 } },
  { key: 'sejong', label: '세종', center: { lat: 36.48, lon: 127.29 } },
  { key: 'gangwon', label: '강원', center: { lat: 37.82, lon: 128.16 } },
  { key: 'chungbuk', label: '충북', center: { lat: 36.8, lon: 127.7 } },
  { key: 'chungnam', label: '충남', center: { lat: 36.52, lon: 126.8 } },
  { key: 'jeonbuk', label: '전북', center: { lat: 35.72, lon: 127.15 } },
  { key: 'jeonnam', label: '전남', center: { lat: 34.9, lon: 126.95 } },
  { key: 'gyeongbuk', label: '경북', center: { lat: 36.3, lon: 128.9 } },
  { key: 'gyeongnam', label: '경남', center: { lat: 35.35, lon: 128.25 } },
  { key: 'jeju', label: '제주', center: { lat: 33.43, lon: 126.56 } },
];

/** 필터 상태. 빈 배열/null/false = 그 축 미적용. */
export interface Filters {
  kinds: MuseumKind[]; // 비면 전체
  sido: string | null;
  openTodayOnly: boolean; // 오늘 개관(restday 'open')인 곳만
}

export const EMPTY_FILTERS: Filters = { kinds: [], sido: null, openTodayOnly: false };

/** 종류·지역 필터를 통과하는가(오늘 여는가는 라우트에서 별도 적용 — 날짜 의존). */
export function matchesFilters(m: Museum, f: Filters): boolean {
  if (f.kinds.length > 0 && !f.kinds.includes(m.kind)) return false;
  if (f.sido && m.sido !== f.sido) return false;
  return true;
}

/** 필터가 하나라도 적용됐는가(빈 상태 안내용). */
export function hasAnyFilter(f: Filters): boolean {
  return f.kinds.length > 0 || f.sido !== null || f.openTodayOnly;
}

/** 종류 토글(불변 업데이트). */
export function toggleKind(kinds: MuseumKind[], k: MuseumKind): MuseumKind[] {
  return kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k];
}
