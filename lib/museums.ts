/**
 * 박물관·미술관 데이터의 정규화. **순수 함수만**(테스트가 여기 붙는다).
 *
 * 소스는 관광공사 국문 KorService2. 오퍼레이션 둘을 합친다: areaBasedList2(목록: 이름·좌표·
 * 주소·이미지) + detailIntro2(관람시간·휴관일·입장료·주차). 휴관일 원문은 restday.ts 가
 * "오늘 여는가"로 해석하고, 이 모듈은 지도·시트에 쓸 필드를 정규화만 한다.
 *
 * 함정(TODO-museum.md):
 *  - contentTypeId=14(국문). 외국어 78 로 부르면 다른 세트가 온다.
 *  - "문화시설"엔 도서관·책방·대형서점이 섞인다 → cat3 로만 박물관류를 거른다.
 *    포함: 박물관 A02060100 · 기념관 A02060200 · 전시관 A02060300 · 미술관/화랑 A02060500.
 *    (도서관·책방은 cat3 가 비어 있어 자연히 빠진다 — 실측 확인.)
 *  - 결측은 결측으로. 지어내지 않는다.
 */

/** 박물관류 cat3 코드(포함 대상). */
export const CAT3_KIND: Record<string, MuseumKind> = {
  A02060100: 'museum', // 박물관
  A02060200: 'memorial', // 기념관
  A02060300: 'exhibition', // 전시관
  A02060500: 'gallery', // 미술관/화랑
};

/** 조회할 cat3 코드 목록(목록 API 를 이 코드들로 각각 부른다). */
export const CAT3_CODES = Object.keys(CAT3_KIND);

export type MuseumKind = 'museum' | 'gallery' | 'exhibition' | 'memorial';

/** 종류 한글 라벨(UI 공통). */
export const KIND_LABEL: Record<MuseumKind, string> = {
  museum: '박물관',
  gallery: '미술관',
  exhibition: '전시관',
  memorial: '기념관',
};

/** areaBasedList2 원본 item(우리가 쓰는 필드만). */
export interface MuseumListRaw {
  contentid?: string;
  title?: string;
  addr1?: string;
  addr2?: string;
  mapx?: string;
  mapy?: string;
  firstimage?: string;
  firstimage2?: string;
  tel?: string;
  cat3?: string;
  areacode?: string;
}

/** detailIntro2 원본(문화시설 계열 필드). */
export interface MuseumIntroRaw {
  restdateculture?: string;
  usetimeculture?: string;
  usefee?: string;
  parkingculture?: string;
  infocenterculture?: string;
}

/** 클라이언트로 내보내는 정규화 박물관. 휴관일은 **원문 그대로**(restRaw) 보존한다. */
export interface Museum {
  id: string;
  title: string;
  kind: MuseumKind;
  addr: string | null;
  /** 시도 key(필터·집계용). areacode 로 매핑. */
  sido: string | null;
  lat: number;
  lon: number;
  image: string | null;
  tel: string | null;
  /** 휴관일 원문(restdateculture). 판정이 틀려도 사용자가 직접 읽을 수 있어야 한다(정직성). */
  restRaw: string | null;
  hours: string | null;
  fee: string | null;
  parking: string | null;
}

const numOrNull = (v: string | undefined): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** KorService2 areacode → 시도 key. (실측 표준 코드표.) */
const AREACODE_SIDO: Record<string, string> = {
  '1': 'seoul', '2': 'incheon', '3': 'daejeon', '4': 'daegu', '5': 'gwangju',
  '6': 'busan', '7': 'ulsan', '8': 'sejong', '31': 'gyeonggi', '32': 'gangwon',
  '33': 'chungbuk', '34': 'chungnam', '35': 'gyeongbuk', '36': 'gyeongnam',
  '37': 'jeonbuk', '38': 'jeonnam', '39': 'jeju',
};

export function sidoOf(areacode: string | undefined): string | null {
  return (areacode && AREACODE_SIDO[areacode.trim()]) || null;
}

export function kindOf(cat3: string | undefined): MuseumKind | null {
  return (cat3 && CAT3_KIND[cat3.trim()]) || null;
}

// 한국 대략 경계(WGS84). 좌표 스왑·쓰레기를 거른다.
const KR_LON = [124, 132] as const;
const KR_LAT = [33, 39] as const;

/**
 * TourAPI 텍스트 필드엔 `<br>` 등 HTML 이 섞여 온다(관람시간·입장료·휴관일). 화면에 리터럴
 * 태그가 보이지 않게 `<br>`→줄바꿈, 나머지 태그는 제거. 줄바꿈은 살리고 그 외 공백만 정리.
 */
export function sanitizeText(v: string | undefined): string | null {
  const s = v
    ?.replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
  return s || null;
}

/**
 * 목록 raw + 상세 raw → 정규화 Museum. 좌표가 없거나 한국 밖이면 null(지도가 존재 이유).
 * cat3 가 박물관류가 아니면 null(도서관·책방 혼입 차단). 제목이 없어도 null.
 */
export function normalizeMuseum(list: MuseumListRaw, intro: MuseumIntroRaw | null): Museum | null {
  const id = list.contentid?.trim();
  const kind = kindOf(list.cat3);
  const title = list.title?.trim();
  const lon = numOrNull(list.mapx);
  const lat = numOrNull(list.mapy);
  if (!id || !kind || !title || lat == null || lon == null) return null;
  if (lon < KR_LON[0] || lon > KR_LON[1] || lat < KR_LAT[0] || lat > KR_LAT[1]) return null;

  const addr = [list.addr1?.trim(), list.addr2?.trim()].filter(Boolean).join(' ').trim() || null;

  return {
    id,
    title,
    kind,
    addr,
    sido: sidoOf(list.areacode),
    lat,
    lon,
    image: list.firstimage?.trim() || list.firstimage2?.trim() || null,
    tel: list.tel?.trim() || null,
    restRaw: sanitizeText(intro?.restdateculture),
    hours: sanitizeText(intro?.usetimeculture),
    fee: sanitizeText(intro?.usefee),
    parking: sanitizeText(intro?.parkingculture),
  };
}

/**
 * 응답 본문에서 items 배열을 안전하게 뽑는다.
 * 정상: response.body.items.item (배열/단일객체, 0건이면 items===""/없음).
 */
export function itemsOf<T = MuseumListRaw>(json: unknown): T[] {
  const body = (json as { response?: { body?: { items?: unknown } } })?.response?.body?.items;
  if (!body || body === '') return [];
  const item = (body as { item?: unknown }).item;
  if (Array.isArray(item)) return item as T[];
  return item ? [item as T] : [];
}

/** 정상 응답의 totalCount(없으면 0). */
export function totalOf(json: unknown): number {
  return (json as { response?: { body?: { totalCount?: number } } })?.response?.body?.totalCount ?? 0;
}

/**
 * 응답이 에러면 { code, msg }, 정상이면 null. 세 자리를 모두 본다(200 이 성공이 아니다):
 *  - OpenAPI_ServiceResponse.cmmMsgHeader (키/쿼터 계열). 30=미신청, 12=서비스없음, 22=일일쿼터, 23=초당제한.
 *  - response.header.resultCode (정상은 "0000").
 *  - 평면 {resultCode:"10", ...} (앱 파라미터 오류; v2 에 overviewYN 붙이면 10 난다).
 */
export function parseApiError(json: unknown): { code: string; msg: string } | null {
  const cmm = (
    json as {
      OpenAPI_ServiceResponse?: { cmmMsgHeader?: { returnReasonCode?: string; errMsg?: string } };
    }
  )?.OpenAPI_ServiceResponse?.cmmMsgHeader;
  if (cmm?.returnReasonCode) return { code: cmm.returnReasonCode, msg: cmm.errMsg ?? 'service error' };

  const header = (json as { response?: { header?: { resultCode?: string; resultMsg?: string } } })
    ?.response?.header;
  if (header?.resultCode && header.resultCode !== '0000') {
    return { code: header.resultCode, msg: header.resultMsg ?? 'service error' };
  }

  const flat = json as { resultCode?: string; resultMsg?: string; response?: unknown };
  if (flat && !flat.response && flat.resultCode && flat.resultCode !== '0000') {
    return { code: flat.resultCode, msg: flat.resultMsg ?? 'service error' };
  }
  return null;
}
