import { NextResponse, after } from 'next/server';

import { getCatalogCached, rotationPending, runIntroRotation } from '@/lib/museum-cache';
import { nearest, SEOUL, type LatLon } from '@/lib/geo';
import { swrCacheControl } from '@/lib/cache-control';
import { kstToday } from '@/lib/kst';
import { openTodayState, type OpenState } from '@/lib/restday';
import { passesOpenTodayFilter } from '@/lib/museum-ui';
import { KIND_OPTIONS, SIDO_OPTIONS, matchesFilters, type Filters } from '@/lib/facets';
import type { Museum, MuseumKind } from '@/lib/museums';
import type { MuseumWithDistance, MuseumsResponse, QueryMode } from '@/lib/types';

/**
 * ★ 이 앱의 심장: 서버 공간 필터 + 종류·지역 필터 + "오늘 여는 곳" 판정.
 *
 * 카탈로그(≈629곳)를 통째로 클라이언트에 내리지 않는다. 서버가 전량을 캐시(하루 1회 상류)하고,
 * 필터·영역을 적용한 뒤 가까운 N건만 골라 내린다. 위치·영역이 바뀌어도 상류는 0.
 *
 * ★ 오늘 여는가(openToday): restRaw → restday.ts 로 KST '오늘' 기준 판정한다. 이 판정은 날짜에
 *   의존하므로 캐시된 정규화 객체가 아니라 여기(라우트)에서 매 요청 계산한다(≈629건, ~1ms).
 *   openTodayOnly 필터는 휴관이 확실한 'closed' 만 제외한다(unknown 은 '추정 개관'으로 포함 — 표시층
 *   정책, lib/museum-ui.ts). 제외 건수는 meta.excludedByOpenToday 로 밝힌다.
 *
 * 캐시 판단:
 *  - **fallback 만 CDN 캐시**(SWR). 좌표·영역이 없어 전 사용자 동일. 단, 오늘 판정이 KST 자정에
 *    바뀌므로 SWR 창을 자정에서 자른다(swrCacheControl 이 처리).
 *  - **location·bounds 는 no-store**. 좌표/영역이 사용자마다 달라 CDN 이 안 먹는다.
 */

// 목록 응답 자체는 <1s(공유 캐시). 다만 응답을 내보낸 뒤 after() 로 도는 상세 회전 백그라운드
// 킥(≤55s, 그날 커버 완료 전까지만)이 함수 수명 안에서 진행하도록 여유를 둔다.
export const maxDuration = 60;

const LIMIT = 300; // 클라이언트로 내리는 최대 건수(전량이 ~629라 넉넉).

function parseCoord(v: string | null, lo: number, hi: number): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) return null;
  return n;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

function parseBounds(sp: URLSearchParams): Bounds | null {
  const minLat = parseCoord(sp.get('minLat'), 30, 40);
  const maxLat = parseCoord(sp.get('maxLat'), 30, 40);
  const minLon = parseCoord(sp.get('minLon'), 122, 134);
  const maxLon = parseCoord(sp.get('maxLon'), 122, 134);
  if (minLat == null || maxLat == null || minLon == null || maxLon == null) return null;
  if (minLat >= maxLat || minLon >= maxLon) return null;
  return { minLat, maxLat, minLon, maxLon };
}

/** kinds 쿼리 파싱: "museum,gallery" → 유효 kind 만. */
function parseKinds(v: string | null): MuseumKind[] {
  if (!v) return [];
  const valid = new Set(KIND_OPTIONS.map((o) => o.key));
  return v
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is MuseumKind => valid.has(s as MuseumKind));
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);

  const bounds = parseBounds(searchParams);
  const lat = parseCoord(searchParams.get('lat'), 33, 39);
  const lon = parseCoord(searchParams.get('lon'), 124, 132);
  const hasLoc = lat != null && lon != null;

  const mode: QueryMode = bounds ? 'bounds' : hasLoc ? 'location' : 'fallback';
  const origin: LatLon = bounds
    ? { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 }
    : hasLoc
      ? { lat: lat as number, lon: lon as number }
      : SEOUL;

  const filters: Filters = {
    kinds: parseKinds(searchParams.get('kinds')),
    sido: searchParams.get('sido')?.trim() || null,
    openTodayOnly: searchParams.get('openToday') === '1',
  };

  try {
    const catalog = await getCatalogCached();
    const today = kstToday();

    // 오늘 개관 판정을 전 항목에 붙인다(날짜 의존이라 여기서 계산).
    const withOpen: MuseumWithDistance[] = catalog.museums.map((m) => ({
      ...m,
      distanceKm: 0,
      openToday: openTodayState(m.restRaw, today) as OpenState,
    }));

    // 1) 종류·지역 필터. 2) bounds 모드면 영역으로 한 번 더. 3) openTodayOnly 면 'closed' 제외.
    let pool = withOpen.filter((m) => matchesFilters(m, filters));
    if (bounds) {
      pool = pool.filter(
        (m) =>
          m.lat >= bounds.minLat &&
          m.lat <= bounds.maxLat &&
          m.lon >= bounds.minLon &&
          m.lon <= bounds.maxLon,
      );
    }

    // openTodayOnly: 제외되는 건수를 세어 정직하게 노출.
    let excludedByOpenToday: { closed: number; unknown: number } | null = null;
    if (filters.openTodayOnly) {
      const closed = pool.filter((m) => m.openToday === 'closed').length;
      // unknown 은 추정 개관으로 포함되므로 제외 건수 0(필드는 호환을 위해 유지).
      excludedByOpenToday = { closed, unknown: 0 };
      pool = pool.filter((m) => passesOpenTodayFilter(m.openToday));
    }

    const ranked = nearest(pool, origin, LIMIT);
    const museums: MuseumWithDistance[] = ranked.map((r) => ({
      ...r.item,
      distanceKm: Math.round(r.distanceKm * 10) / 10,
    }));

    // 지금 목록(필터 적용 후) 오늘 개관 분포.
    const openBreakdown = {
      open: pool.filter((m) => m.openToday === 'open').length,
      closed: pool.filter((m) => m.openToday === 'closed').length,
      unknown: pool.filter((m) => m.openToday === 'unknown').length,
    };

    const all = catalog.museums;
    const countKind = (k: MuseumKind) => all.filter((m: Museum) => m.kind === k).length;
    const countSido = (s: string) => all.filter((m: Museum) => m.sido === s).length;

    const body: MuseumsResponse = {
      museums,
      counts: {
        kind: KIND_OPTIONS.map((o) => ({ key: o.key, count: countKind(o.key) })),
        sido: SIDO_OPTIONS.map((o) => ({ key: o.key, count: countSido(o.key) })),
        openToday: openBreakdown,
      },
      meta: {
        mode,
        returned: museums.length,
        matched: pool.length,
        total: all.length,
        noCoords: catalog.noCoords,
        usedFallback: mode === 'fallback',
        truncated: pool.length > museums.length,
        introCoverage: catalog.introCoverage,
        excludedByOpenToday,
      },
    };

    // ★ 응답을 내보낸 뒤(after) 상세 회전을 백그라운드로 이어 돌려 이 인스턴스의 introStore 를
    //   self-heal 한다. 목록 응답은 이미 위에서 완성됐으니 회전은 절대 응답을 지연시키지 않는다.
    //   그날 커버 완료·쿼터·예산 소진 시 rotationPending() 이 false 가 돼 더는 킥하지 않는다.
    if (rotationPending()) {
      after(async () => {
        await runIntroRotation().catch(() => {});
      });
    }

    return NextResponse.json(body, {
      headers: {
        // fallback(전 사용자 동일)만 CDN 캐시. 오늘 판정이 KST 자정에 바뀌므로 SWR 창을 자정에서 자른다.
        'Cache-Control': mode === 'fallback' ? swrCacheControl(1800) : 'no-store',
      },
    });
  } catch (e) {
    const code = e instanceof Error && 'code' in e ? (e as { code: string }).code : 'ERROR';
    return NextResponse.json(
      { error: 'upstream', code },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
