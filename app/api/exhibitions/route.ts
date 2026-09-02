import { NextResponse } from 'next/server';

import { getExhibitionsCached } from '@/lib/exhibition-cache';
import { overlaps, rangeFor, type Exhibition, type Timeframe } from '@/lib/exhibitions';
import { haversineKm, SEOUL, type LatLon } from '@/lib/geo';
import { dayOfWeek, kstToday, monthEndDay } from '@/lib/kst';
import { swrCacheControl } from '@/lib/cache-control';
import type { ExhibitionWithDistance, ExhibitionsResponse } from '@/lib/types';

/**
 * "지금 하는 전시"(축 2). 시간축(today/weekend/month)에 걸리는 전시를 돌려준다. 박물관 축과
 * **독립**이라 이 축이 실패해도 박물관 지도는 멀쩡하다(결합 해제).
 *
 * 좌표 있는 전시(지도+목록)와 없는 전시(목록 전용)를 나눠 개수를 밝힌다(억지 좌표 금지). 위치가
 * 있으면 좌표 보유분을 거리순, 없으면 마감 임박순으로 정렬한다.
 */
export const maxDuration = 30;

const LIMIT = 500;

function parseCoord(v: string | null, lo: number, hi: number): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return n;
}

function parseTf(v: string | null): Timeframe {
  return v === 'weekend' || v === 'month' ? v : 'today';
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const tf = parseTf(searchParams.get('tf'));
  const lat = parseCoord(searchParams.get('lat'), 33, 39);
  const lon = parseCoord(searchParams.get('lon'), 124, 132);
  const hasLoc = lat != null && lon != null;
  const origin: LatLon = hasLoc ? { lat: lat as number, lon: lon as number } : SEOUL;

  try {
    const all = await getExhibitionsCached();
    const today = kstToday();
    const { from, to } = rangeFor(tf, today, monthEndDay(today), dayOfWeek(today));

    const inRange = all.filter((e) => overlaps(e, from, to));

    const withDist = (e: Exhibition): ExhibitionWithDistance => ({
      ...e,
      distanceKm:
        e.lat != null && e.lon != null
          ? Math.round(haversineKm(origin, { lat: e.lat, lon: e.lon }) * 10) / 10
          : null,
    });

    const mappedAll = inRange.filter((e) => e.lat != null && e.lon != null).map(withDist);
    const listOnlyAll = inRange.filter((e) => e.lat == null).map(withDist);

    // 좌표 보유: 위치 있으면 거리순, 없으면 마감 임박순. 목록전용: 마감 임박순.
    mappedAll.sort((a, b) =>
      hasLoc ? (a.distanceKm ?? 0) - (b.distanceKm ?? 0) : a.endDay - b.endDay,
    );
    listOnlyAll.sort((a, b) => a.endDay - b.endDay);

    const mapped = mappedAll.slice(0, LIMIT);
    const listOnly = listOnlyAll.slice(0, LIMIT);

    const body: ExhibitionsResponse = {
      mapped,
      listOnly,
      meta: {
        timeframe: tf,
        total: inRange.length,
        mappedCount: mappedAll.length,
        noCoords: listOnlyAll.length,
        truncated: mapped.length < mappedAll.length || listOnly.length < listOnlyAll.length,
      },
    };
    // 위치 무관 부분(전 사용자 동일)만 CDN 캐시. 위치가 오면 거리정렬이 달라 no-store.
    return NextResponse.json(body, {
      headers: { 'Cache-Control': hasLoc ? 'no-store' : swrCacheControl(1800) },
    });
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
