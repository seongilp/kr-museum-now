import { NextResponse } from 'next/server';

import { getCatalogCached } from '@/lib/museum-cache';
import { kstToday } from '@/lib/kst';
import { openTodayState } from '@/lib/restday';
import type { MuseumWithDistance } from '@/lib/types';

/**
 * 단건 조회. 팔레트에서 '가까운 목록 밖'의 박물관을 골랐을 때, 지도·상세에 합류시키려고 부른다.
 * 카탈로그(이미 캐시)에서 찾을 뿐 상류를 새로 때리지 않는다. 오늘 개관 판정도 붙여 준다.
 * 거리(distanceKm)는 클라이언트가 자기 위치로 계산하므로 0 으로 둔다.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const catalog = await getCatalogCached();
    const m = catalog.museums.find((x) => x.id === id);
    if (!m) {
      return NextResponse.json(
        { error: 'not_found' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const museum: MuseumWithDistance = {
      ...m,
      distanceKm: 0,
      openToday: openTodayState(m.restRaw, kstToday()),
    };
    // 오늘 판정 포함이라 KST 자정까지만 캐시(자정에 바뀜).
    return NextResponse.json(
      { museum },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' } },
    );
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
