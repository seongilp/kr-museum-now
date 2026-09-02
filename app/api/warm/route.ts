import { NextResponse } from 'next/server';

/**
 * 카탈로그 예열(cron). **첫 사용자가 콜드 수집(≈629 detailIntro2)을 안 밟도록** 미리 데운다.
 *
 * 좌표 없는 엔드포인트(`/api/museums`)를 자기 공개 URL 로 때린다:
 *  - 카탈로그를 **인스턴스 간 공유 Data Cache** 에 채운다(museum-api 의 fetch revalidate).
 *  - 그 응답은 좌표 없이 전 사용자 동일이라 **CDN 에도** 채워진다(라우트가 SWR 헤더를 붙임).
 *
 * ★ Vercel Hobby 크론은 하루 1회. vercel.json 에서 KST 자정 직후(UTC 15:00)로 잡아, SWR 창과
 *   Data Cache 가 KST 자정에 만료된 뒤 그날 첫 수집을 이 예열이 커버하게 한다. "오늘 여는가"
 *   판정도 자정에 바뀌므로 예열이 새 하루의 첫 계산을 미리 돌려 둔다.
 *
 * 쿼터: 하루 1회 예열 = areaBasedList2 4콜 + detailIntro2 ≤629콜(오퍼레이션당 1,000/일 한도 내).
 * 시간예산(museum-api BUDGET_MS=45s)이 있어 한 번에 못 끝내도 부분 캐시가 남고, 그날 첫 사용자
 * 요청이 Data Cache HIT 로 나머지를 마저 채운다.
 *
 * fail closed: CRON_SECRET 없으면 503, 안 맞으면 401.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function baseUrl(): string {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'kr-museum-now.vercel.app';
  return `https://${host}`;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET 이 설정되지 않았습니다 (fail closed).' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
  if (request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json(
      { error: '인증 실패' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const started = Date.now();
  try {
    const res = await fetch(`${baseUrl()}/api/museums`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(55_000),
      headers: { Accept: 'application/json' },
    });
    const ms = Date.now() - started;
    const cache = res.headers.get('x-vercel-cache');
    if (!res.ok) {
      return NextResponse.json(
        { ok: false, status: res.status, cache, ms },
        { status: 502, headers: { 'Cache-Control': 'no-store' } },
      );
    }
    const body = (await res.json()) as {
      museums?: unknown[];
      meta?: { total?: number; noCoords?: number; introCoverage?: number };
    };
    return NextResponse.json(
      {
        ok: true,
        warmedAt: new Date().toISOString(),
        ms,
        cache,
        returned: Array.isArray(body.museums) ? body.museums.length : 0,
        total: body.meta?.total ?? 0,
        noCoords: body.meta?.noCoords ?? 0,
        introCoverage: body.meta?.introCoverage ?? 0,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: message, ms: Date.now() - started },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
