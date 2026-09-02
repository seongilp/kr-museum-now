import type { Museum, MuseumKind } from './museums';
import type { OpenState } from './restday';

/** API 가 내려주는 박물관(정규화 Museum + 서버 계산 거리 + 오늘 개관 판정). */
export interface MuseumWithDistance extends Museum {
  distanceKm: number;
  /** KST '오늘' 기준 개관 판정(restRaw → restday.ts). open/closed/unknown 세 상태. */
  openToday: OpenState;
}

/** 각 축의 카운트(칩 라벨 옆 숫자). */
export interface FacetCount {
  key: string;
  count: number;
}

/** 지도에 보이는 영역(WGS84). 서버 bounds 조회 파라미터로 그대로 넘어간다. */
export interface MapBounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

/** 커맨드 팔레트 이름검색용 경량 인덱스 항목. */
export interface MuseumIndexItem {
  id: string;
  title: string;
  kind: MuseumKind;
  sido: string | null;
  lat: number;
  lon: number;
}

/**
 * 조회 모드. 리스트 정렬·헤더 문구·거리 표시 여부를 가른다.
 *  - location: 사용자 실제 위치 기준 가까운 순(거리 표시)
 *  - bounds:   지도에 보이는 영역 안(거리 미표시 — 임의 중심 기준이라 오해 소지)
 *  - fallback: 위치 없음 → 서울 기준(거리 미표시)
 */
export type QueryMode = 'location' | 'bounds' | 'fallback';

/** '오늘 여는가' 상태 분포(필터를 켜기 전 전체 기준). 킬러 필터의 정직성 근거. */
export interface OpenBreakdown {
  open: number;
  closed: number;
  unknown: number;
}

/** /api/museums 응답. */
export interface MuseumsResponse {
  museums: MuseumWithDistance[];
  counts: {
    kind: FacetCount[];
    sido: FacetCount[];
    /** 지금 목록(필터·영역 적용 후)의 오늘 개관 분포. */
    openToday: OpenBreakdown;
  };
  meta: {
    mode: QueryMode;
    returned: number;
    matched: number; // 종류·지역·(오늘여는곳) 필터 + 영역 통과 건수
    total: number; // 좌표 있는 전체 건수
    noCoords: number; // 좌표가 없어 지도에 못 찍는 건수(정직 노출)
    usedFallback: boolean;
    truncated: boolean; // matched > returned
    introCoverage: number; // 휴관일 상세 병합률(부분 결측 고지용)
    /** 오늘여는곳 필터가 켜졌을 때, 그 때문에 제외된 건수(조용히 숨기지 않는다). */
    excludedByOpenToday: { closed: number; unknown: number } | null;
  };
}
