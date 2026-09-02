import { NextResponse } from 'next/server';

import { getListCatalogDirect } from '@/lib/museum-cache';

/**
 * 내부 라우트: **목록 카탈로그**(Museum[] + noCoords, 상세 미병합)를 JSON 으로 돌려준다.
 * 공개 라우트가 이걸 self-fetch(`next:{revalidate}`)로 한 번 불러 인스턴스 간 공유 Data Cache 에
 * 태운다 — museum-cache 주석 참조.
 *
 * ★ 목록은 areaBasedList2 1콜(≈1s)로 만들어지고 상세 회전을 절대 기다리지 않는다. 목록 자체가
 *   성공하면 **항상 200** 이라 Next Data Cache 가 자정까지 저장 → 콜드 인스턴스도 <1s 로 공유본을
 *   읽는다. 목록 자체 실패(EMPTY)만 502 로 던져 빈 카탈로그를 서빙·캐시하지 않는다.
 * 자기 응답 자체는 no-store(캐싱은 호출부 self-fetch 의 revalidate 가 담당).
 */
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

export async function GET() {
  try {
    const catalog = await getListCatalogDirect();
    return NextResponse.json(catalog, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    // 목록 자체 실패(진짜 장애)만 여기로. 빈 카탈로그를 서빙·캐시하지 않는다.
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
