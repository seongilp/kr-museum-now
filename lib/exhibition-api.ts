/**
 * 공연전시 API(B553457) 클라이언트. **서버 전용.** period2(기간별)만 쓴다.
 *
 * ── 함정 ──
 *  - **XML 응답**(JSON 파라미터 없음). 정규식으로 item 필드를 뽑는다(필드가 평면이라 안전).
 *  - 페이지 크기 파라미터는 **`numOfrows`(소문자 r)**, 페이지는 `cPage`. `rows`/`numOfRows` 는 무시됨.
 *  - from<to 범위는 교차(intersect). from==to 는 '오늘 시작'만 잡히는 함정이라 쓰지 않는다.
 *  - serviceKey verbatim(재인코딩 금지). resultCode 00 = 정상(관광공사 KorService2 의 0000 과 다르다).
 *
 * 쿼터: 한 창(today~today+N)만 페이징(보통 1~2콜/일)해 자정까지 캐시. 1,000/일 한도에 여유가 크다.
 */

import { type ExhibitionRaw } from './exhibitions';

const HOST = 'https://apis.data.go.kr/B553457/cultureinfo/period2';
const TIMEOUT_MS = 8000;
const PAGE_ROWS = 1000;
const MAX_PAGES = 6; // 방어적 상한(창을 좁게 잡으므로 보통 1~2페이지).

export class ExhibitionApiFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ExhibitionApiFailure';
  }
}

function serviceKey(): string {
  const key = process.env.DATA_GO_KR_KEY?.trim() || process.env.HORSE?.trim();
  if (!key) throw new ExhibitionApiFailure('NO_KEY', 'DATA_GO_KR_KEY 가 설정되지 않았습니다.');
  return key.includes('%') ? key : encodeURIComponent(key);
}

/** XML 한 덩어리에서 <item>…</item> 들을 평면 파싱. (테스트가 붙는다.) */
export function parseItems(xml: string): ExhibitionRaw[] {
  const field = (block: string, tag: string): string | undefined => {
    const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(block);
    return m ? m[1].trim() : undefined;
  };
  const out: ExhibitionRaw[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    out.push({
      seq: field(b, 'seq'),
      title: field(b, 'title'),
      startDate: field(b, 'startDate'),
      endDate: field(b, 'endDate'),
      place: field(b, 'place'),
      area: field(b, 'area'),
      sigungu: field(b, 'sigungu'),
      realmName: field(b, 'realmName'),
      thumbnail: field(b, 'thumbnail'),
      gpsX: field(b, 'gpsX'),
      gpsY: field(b, 'gpsY'),
    });
  }
  return out;
}

/**
 * 응답 XML 판정. 정상/에러 구조가 다르다(실측):
 *   정상  <response><header><resultCode>00</resultCode>…<items><item>
 *   에러  <OpenAPI_ServiceResponse><cmmMsgHeader><returnReasonCode>30</returnReasonCode>
 * ok=true 는 <resultCode>00 일 때만. 그 외(에러 헤더·빈 응답)는 code 를 뽑아 실패로 본다.
 * (테스트가 붙는다.)
 */
export function readResult(xml: string): { ok: boolean; code: string } {
  const rc = /<resultCode>([^<]*)<\/resultCode>/.exec(xml)?.[1]?.trim();
  if (rc === '00') return { ok: true, code: '00' };
  const reason = /<returnReasonCode>([^<]*)<\/returnReasonCode>/.exec(xml)?.[1]?.trim();
  return { ok: false, code: reason ?? rc ?? 'ERR' };
}
export function totalCountOf(xml: string): number {
  const m = /<totalCount>(\d+)<\/totalCount>/.exec(xml);
  return m ? Number(m[1]) : 0;
}

async function fetchPage(fromYmd: string, toYmd: string, cPage: number, revalidate: number): Promise<string> {
  const url =
    `${HOST}?serviceKey=${serviceKey()}&from=${fromYmd}&to=${toYmd}` +
    `&numOfrows=${PAGE_ROWS}&cPage=${cPage}&sortStdr=1`;
  const res = await fetch(url, {
    headers: { Accept: 'application/xml' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    next: { revalidate },
  });
  const text = await res.text();
  const { ok, code } = readResult(text);
  if (!ok) throw new ExhibitionApiFailure(code, `공연전시 API 실패: ${text.slice(0, 120)}`);
  return text;
}

/**
 * [fromYmd, toYmd] 창(교차)의 전시·공연 원본 전량. 페이징(numOfrows=1000). Data Cache 로
 * 인스턴스 간 공유(revalidate = 자정까지). 창을 좁게 잡으므로 보통 1~2콜.
 */
export async function fetchExhibitionsWindow(
  fromYmd: string,
  toYmd: string,
  revalidate: number,
): Promise<ExhibitionRaw[]> {
  const first = await fetchPage(fromYmd, toYmd, 1, revalidate);
  const total = totalCountOf(first);
  const acc = parseItems(first);
  const pages = Math.min(MAX_PAGES, Math.ceil(total / PAGE_ROWS));
  for (let p = 2; p <= pages; p += 1) {
    acc.push(...parseItems(await fetchPage(fromYmd, toYmd, p, revalidate)));
  }
  return acc;
}
