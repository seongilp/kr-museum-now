import { NextResponse } from 'next/server';

import { runIntroRotation, staticIntroInfo } from '@/lib/museum-cache';

/**
 * 카탈로그 예열(cron). 요청 경로 밖에서 두 가지를 해 둔다:
 *
 *  1) **상세 회전 수집**(`runIntroRotation`) — 정적 스냅샷(`data/intros.json`)에 없는 신규 id 만
 *     이 인스턴스의 introStore 에 그날 예산(≤150)만큼 채운다. 회전은 목록 응답을 붙잡지 않으므로
 *     여기(크론)와 공개 라우트의 `after()` 백그라운드 킥에서만 돈다.
 *  2) **목록 공유 캐시 + CDN 예열** — 자기 공개 URL(`/api/museums`, 좌표 없음)을 때려 목록 카탈로그를
 *     인스턴스 간 공유 Data Cache 와 CDN(SWR 헤더)에 채운다. → 첫 사용자가 콜드 목록 빌드를 안 밟는다.
 *
 * ★ Vercel Hobby 크론은 하루 1회. vercel.json 에서 KST 자정 직후(UTC 15:00)로 잡아, 공유 캐시·SWR
 *   창이 KST 자정에 만료된 뒤 그날 첫 수집을 이 예열이 커버하게 한다. "오늘 여는가" 판정도 자정에
 *   바뀌므로 예열이 새 하루의 첫 계산을 미리 돌려 둔다.
 *
 * 쿼터: 하루 1회 = detailIntro2 ≤150콜(회전; 오프라인 수집기 ≤800 과 같은 일일 쿼터를 나눠 씀) +
 * areaBasedList2 소수(오퍼레이션당 1,000/일 한도 내).
 * 회전은 시간예산(museum-api BUDGET_MS=55s)·code22 로 스스로 멈춘다.
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

  // 1) 목록 공유 캐시 + CDN 예열(빠름, ≈1s). 실패해도 회전은 계속 시도한다.
  let listWarm: { ok: boolean; status: number; cache: string | null; returned: number } | null = null;
  try {
    const res = await fetch(`${baseUrl()}/api/museums`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as { museums?: unknown[] };
    listWarm = {
      ok: res.ok,
      status: res.status,
      cache: res.headers.get('x-vercel-cache'),
      returned: Array.isArray(body.museums) ? body.museums.length : 0,
    };
  } catch (error) {
    listWarm = {
      ok: false,
      status: 0,
      cache: error instanceof Error ? error.name : 'ERR',
      returned: 0,
    };
  }

  // 2) 상세 회전 수집(이 인스턴스 introStore 채움). 목록과 독립 — 실패는 리포트에 담고 200 유지.
  try {
    const rotation = await runIntroRotation();
    return NextResponse.json(
      {
        ok: true,
        warmedAt: new Date().toISOString(),
        ms: Date.now() - started,
        listWarm,
        staticIntros: staticIntroInfo(),
        rotation,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { ok: false, error: message, listWarm, ms: Date.now() - started },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
