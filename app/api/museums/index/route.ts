import { NextResponse } from 'next/server';

import { getCatalogCached } from '@/lib/museum-cache';
import { swrCacheControl } from '@/lib/cache-control';
import type { MuseumIndexItem } from '@/lib/types';

/**
 * 커맨드 팔레트(⌘K) 이름 검색용 **경량 인덱스**. 전량(≈629곳)의 {id,title,kind,sido,lat,lon} 만.
 *
 * 지도용 응답은 가까운 N곳 위주라, 전국 이름검색을 하려면 전체 이름이 클라이언트에 있어야 한다.
 * 그렇다고 전체 Museum(관람시간·휴관일 등)을 다 내리면 무거우니 검색·지도이동에 필요한 필드만 추린다.
 * **상류 호출을 늘리지 않는다**(이미 캐시된 카탈로그에서 읽음). 위치 무관·전 사용자 동일이라
 * CDN 이 KST 자정까지 캐시. 팔레트 최초 오픈 시 1회만 받는다.
 */
export async function GET() {
  try {
    const catalog = await getCatalogCached();
    const items: MuseumIndexItem[] = catalog.museums.map((m) => ({
      id: m.id,
      title: m.title,
      kind: m.kind,
      sido: m.sido,
      lat: m.lat,
      lon: m.lon,
    }));
    return NextResponse.json({ items }, { headers: { 'Cache-Control': swrCacheControl(3600) } });
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
