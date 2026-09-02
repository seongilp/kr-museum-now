/**
 * 박물관·미술관 데이터의 정규화. **순수 함수만**(테스트가 여기 붙는다).
 *
 * 소스는 관광공사 국문 KorService2(문화시설, contentTypeId=14).
 *
 * ── ★ 분류는 cat3 가 아니라 lclsSystm3 로 한다(핵심 교훈) ──
 * cat3(A0206xx)는 **절반만 채워져 있다.** 국립중앙박물관조차 cat1/cat2/cat3 가 전부 빈값이라
 * cat3 필터는 대표 박물관들을 통째로 떨어뜨린다(초기 버전의 치명적 누락). 반면 신형 분류
 * **lclsSystm3 은 문화시설 2,723곳 전부에 채워져 있다**(실측). 그래서 lclsSystm3 로 판별한다 —
 * 이름 매칭 같은 오탐 위험이 없는, 관광공사 자신의 분류다.
 *
 *   VE070100 박물관(590) · VE070300 전시관(517) · VE070600 미술관/화랑(359)
 *   VE070200 기념관/문학관(154) · VE070500 과학관/천문대(60)   → 합 ≈1,680
 * 제외(비박물관): VE060100 공연장/아트홀 · VE090300 도서관 · VE090100 문화원 · VE120100 책방·서점
 *   · VE070400 컨벤션 · VE060200 극장 · VE090600 학교/서당 · VE02xx 아쿠아리움/천문대(관광) 등.
 *
 * 함정:
 *  - contentTypeId=14(국문). 좌표(mapx/mapy) 없으면 지도에 못 찍으니 드롭(개수 고지).
 *  - 결측은 결측으로. 지어내지 않는다.
 */

/** lclsSystm3 → 종류(포함 대상만). 이 맵에 없는 코드는 박물관류가 아니다(드롭). */
export const LCLS_KIND: Record<string, MuseumKind> = {
  VE070100: 'museum', // 박물관
  VE070300: 'exhibition', // 전시관
  VE070600: 'gallery', // 미술관/화랑
  VE070200: 'memorial', // 기념관/문학관
  VE070500: 'science', // 과학관/천문대
};

export type MuseumKind = 'museum' | 'gallery' | 'exhibition' | 'memorial' | 'science';

/** 종류 한글 라벨(UI 공통). */
export const KIND_LABEL: Record<MuseumKind, string> = {
  museum: '박물관',
  gallery: '미술관',
  exhibition: '전시관',
  memorial: '기념관',
  science: '과학관',
};

/** 판별 근거(추적용). cat3=구분류로도 잡힘 / lcls=cat3 빈값, 신형 분류로만 잡힘. */
export type ClassSource = 'cat3' | 'lcls';

/** 구 cat3 코드 → 종류(판별 근거 태깅·대조용. 분류 자체는 lclsSystm3 이 한다). */
const CAT3_KIND: Record<string, MuseumKind> = {
  A02060100: 'museum',
  A02060300: 'exhibition',
  A02060500: 'gallery',
  A02060200: 'memorial',
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
  lclsSystm3?: string;
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
  /** 분류 근거(cat3 로도 잡힘 / lcls 로만 잡힘). 추적·디버깅용. */
  source: ClassSource;
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

/**
 * addr1 앞 토큰(시도명) → 시도 key. **areacode 가 빈값인 경우의 대체 판별.**
 * cat3 빈값 박물관(국립중앙박물관 등 1,051곳)은 areacode 도 빈값이라 areacode 만으론 지역 필터에서
 * 통째로 빠진다(국립중앙박물관이 '서울' 필터에 안 잡히던 함정). 이들 전부 addr1 은 채워져 있다(실측).
 * 첫 토큰만 startsWith 로 본다 — "경기도 광주시" 를 gwangju 로 오인하지 않기 위해(그건 gyeonggi).
 */
const ADDR_SIDO_RULES: [prefix: string, key: string][] = [
  ['서울', 'seoul'], ['부산', 'busan'], ['대구', 'daegu'], ['인천', 'incheon'],
  ['광주', 'gwangju'], ['대전', 'daejeon'], ['울산', 'ulsan'], ['세종', 'sejong'],
  ['경기', 'gyeonggi'], ['강원', 'gangwon'], ['제주', 'jeju'],
  ['충청북', 'chungbuk'], ['충북', 'chungbuk'], ['충청남', 'chungnam'], ['충남', 'chungnam'],
  ['전라북', 'jeonbuk'], ['전북', 'jeonbuk'], ['전라남', 'jeonnam'], ['전남', 'jeonnam'],
  ['경상북', 'gyeongbuk'], ['경북', 'gyeongbuk'], ['경상남', 'gyeongnam'], ['경남', 'gyeongnam'],
];

export function sidoFromAddr(addr1: string | undefined): string | null {
  const first = addr1?.trim().split(/\s+/)[0];
  if (!first) return null;
  for (const [prefix, key] of ADDR_SIDO_RULES) if (first.startsWith(prefix)) return key;
  return null;
}

/** areacode 우선, 빈값이면 addr1 로 대체. */
export function sidoOf(areacode: string | undefined, addr1?: string): string | null {
  return (areacode && AREACODE_SIDO[areacode.trim()]) || sidoFromAddr(addr1);
}

/** lclsSystm3 로 박물관류 종류를 판별. 박물관류가 아니면 null. */
export function kindOf(lclsSystm3: string | undefined): MuseumKind | null {
  return (lclsSystm3 && LCLS_KIND[lclsSystm3.trim()]) || null;
}

// 한국 대략 경계(WGS84). 좌표 스왑·쓰레기를 거른다.
const KR_LON = [124, 132] as const;
const KR_LAT = [33, 39] as const;

/**
 * TourAPI 텍스트 필드엔 `<br>` 등 HTML 이 섞여 온다. 화면에 리터럴 태그가 안 보이게 `<br>`→줄바꿈,
 * 나머지 태그 제거. 줄바꿈은 살리고 그 외 공백만 정리.
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
 * lclsSystm3 가 박물관류가 아니면 null(도서관·공연장·책방 배제). 제목이 없어도 null.
 */
export function normalizeMuseum(list: MuseumListRaw, intro: MuseumIntroRaw | null): Museum | null {
  const id = list.contentid?.trim();
  const kind = kindOf(list.lclsSystm3);
  const title = list.title?.trim();
  const lon = numOrNull(list.mapx);
  const lat = numOrNull(list.mapy);
  if (!id || !kind || !title || lat == null || lon == null) return null;
  if (lon < KR_LON[0] || lon > KR_LON[1] || lat < KR_LAT[0] || lat > KR_LAT[1]) return null;

  const addr = [list.addr1?.trim(), list.addr2?.trim()].filter(Boolean).join(' ').trim() || null;
  const cat3 = list.cat3?.trim();
  const source: ClassSource = cat3 && CAT3_KIND[cat3] ? 'cat3' : 'lcls';

  return {
    id,
    title,
    kind,
    addr,
    sido: sidoOf(list.areacode, list.addr1),
    lat,
    lon,
    image: list.firstimage?.trim() || list.firstimage2?.trim() || null,
    tel: list.tel?.trim() || null,
    restRaw: sanitizeText(intro?.restdateculture),
    hours: sanitizeText(intro?.usetimeculture),
    fee: sanitizeText(intro?.usefee),
    parking: sanitizeText(intro?.parkingculture),
    source,
  };
}

/**
 * 목록 정규화 Museum 에 상세 원문(intro)을 **병합한 새 객체**(불변). intro=null 이면 그대로 반환.
 * 목록/상세 결합 해제의 마지막 단계 — 목록은 항상 먼저(intro 없이) 정규화해 두고, 상세가 나중에
 * (회전 수집으로) 도착하면 여기서 준정적 필드(휴관일·관람시간·요금·주차)만 채운다.
 */
export function applyIntro(m: Museum, intro: MuseumIntroRaw | null): Museum {
  if (!intro) return m;
  return {
    ...m,
    restRaw: sanitizeText(intro.restdateculture),
    hours: sanitizeText(intro.usetimeculture),
    fee: sanitizeText(intro.usefee),
    parking: sanitizeText(intro.parkingculture),
  };
}

/**
 * 목록 카탈로그 + 상세 조회함수 → 상세 병합 결과 + 병합률(introCoverage). **순수 함수**(테스트 대상).
 * lookup(id) 규약: `undefined`=미수집(병합률에서 제외) / `null`=수집됨(휴관일 원문 없음, 병합률 포함) /
 * 객체=수집됨. 즉 "수집 시도해 결과가 있음"과 "아직 안 받음"을 구분해 결측을 값인 척하지 않는다.
 */
export function mergeIntros(
  museums: Museum[],
  lookup: (id: string) => MuseumIntroRaw | null | undefined,
): { museums: Museum[]; introCoverage: number } {
  let covered = 0;
  const merged = museums.map((m) => {
    const intro = lookup(m.id);
    if (intro === undefined) return m; // 미수집 — 목록 필드만(restRaw=null → openToday=unknown)
    covered += 1;
    return applyIntro(m, intro);
  });
  return { museums: merged, introCoverage: museums.length ? covered / museums.length : 0 };
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
 *  - OpenAPI_ServiceResponse.cmmMsgHeader. 30=미신청, 12=서비스없음, 22=일일쿼터, 23=초당제한.
 *  - response.header.resultCode (정상은 "0000").
 *  - 평면 {resultCode:"10", ...} (파라미터 오류).
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
