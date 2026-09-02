import { NextResponse } from 'next/server';

import { getCatalogDirect } from '@/lib/museum-cache';

/**
 * 내부 라우트: 조립된 카탈로그(Museum[] + introCoverage + noCoords)를 JSON 으로 돌려준다.
 * 공개 라우트가 이걸 self-fetch(`next:{revalidate}`)로 한 번 불러 인스턴스 간 공유 Data Cache 에
 * 태운다 — museum-cache 주석 참조.
 *
 * ★ status 로 캐시 공유 여부를 가른다:
 *  - **완전 빌드(full) → 200**: Next Data Cache 가 자정까지 저장 → 인스턴스 간 공유(상류 ~629/일).
 *  - **부분 빌드(상세 쿼터·throttle) → 503**: Next 는 비-2xx 를 Data Cache 에 담지 않으므로 공유
 *    안 됨. **본문에는 부분 카탈로그(유효한 목록)를 그대로 실어** 호출부가 목록·지도를 살려 쓰게 한다.
 * 자기 응답 자체는 no-store(캐싱은 호출부 self-fetch 의 revalidate 가 담당).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const { catalog, full } = await getCatalogDirect();
    return NextResponse.json(catalog, {
      status: full ? 200 : 503, // 503=부분 빌드(공유 캐시 금지), 본문은 유효
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    // 목록 자체 실패(진짜 장애)만 여기로. 빈 카탈로그를 서빙·캐시하지 않는다.
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
