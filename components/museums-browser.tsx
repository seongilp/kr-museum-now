'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clock, Landmark, Loader2, MapPin, Search } from 'lucide-react';

import type { LatLon } from '@/lib/geo';
import { SEOUL, haversineKm } from '@/lib/geo';
import type { MuseumIndexItem, MuseumWithDistance, MuseumsResponse, MapBounds } from '@/lib/types';
import type { MuseumKind } from '@/lib/museums';
import {
  EMPTY_FILTERS,
  KIND_OPTIONS,
  SIDO_OPTIONS,
  hasAnyFilter,
  toggleKind,
  type Filters,
} from '@/lib/facets';
import { OPEN_STATE_COLOR } from '@/lib/museum-ui';
import { cn } from '@/lib/utils';
import { MuseumCard } from '@/components/museum-card';
import { MuseumDetail } from '@/components/museum-detail';
import { MuseumsMap, type FlyTarget, type MapPoint } from '@/components/museums-map';
import { CommandPalette } from '@/components/command-palette';

/**
 * 상세(휴관일) 병합률이 이 미만이면 "오늘 여는가" 판정을 신뢰할 수 없다 → 필터 비활성화 + 사유 고지.
 * 상세와 목록을 결합 해제하는 임계치(목록은 이보다 낮아도 항상 표시).
 */
const OPEN_JUDGE_MIN = 0.5;

/** 위치 상태를 명확히 구분(무한 로딩 금지). */
type GeoState =
  | { kind: 'locating' }
  | { kind: 'granted'; at: LatLon }
  | { kind: 'denied' }
  | { kind: 'unavailable' }
  | { kind: 'unsupported' };

/** 데이터 로딩 상태. "0건"·"로딩중"·"실패"를 절대 섞지 않는다. */
type DataState =
  | { kind: 'loading' }
  | { kind: 'error'; code?: string }
  | { kind: 'ready'; data: MuseumsResponse };

export function MuseumsBrowser() {
  const [data, setData] = useState<DataState>({ kind: 'loading' });
  // 마지막 성공 응답 보존 — 재요청(loading) 동안 지도가 언마운트되지 않게(튐 방지).
  const [lastReady, setLastReady] = useState<MuseumsResponse | null>(null);
  const [geo, setGeo] = useState<GeoState>({ kind: 'locating' });
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [index, setIndex] = useState<MuseumIndexItem[] | null>(null);
  const [indexLoading, setIndexLoading] = useState(false);
  const [extra, setExtra] = useState<MuseumWithDistance | null>(null);
  const [bounds, setBounds] = useState<MapBounds | null>(null);
  const [flyTo, setFlyTo] = useState<FlyTarget | null>(null);
  const flyKeyRef = useRef(0);
  const paletteOpenRef = useRef(paletteOpen);
  useEffect(() => void (paletteOpenRef.current = paletteOpen), [paletteOpen]);

  const hasRealLocation = geo.kind === 'granted';
  const origin: LatLon = geo.kind === 'granted' ? geo.at : SEOUL;

  const flyToPoint = useCallback((lat: number, lon: number, zoom: number) => {
    flyKeyRef.current += 1;
    setFlyTo({ lat, lon, zoom, key: flyKeyRef.current });
  }, []);

  /* 위치 — 진입 시 한 번. 거부/불가/미지원을 각각 다른 상태로, 어느 경우든 서울 폴백. */
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setGeo({ kind: 'unsupported' });
      return;
    }
    let alive = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (alive) setGeo({ kind: 'granted', at: { lat: pos.coords.latitude, lon: pos.coords.longitude } });
      },
      (err) => {
        if (!alive) return;
        setGeo({ kind: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
    return () => {
      alive = false;
    };
  }, []);

  const requestLocation = () => {
    setGeo({ kind: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const at = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setGeo({ kind: 'granted', at });
        setBounds(null);
        flyToPoint(at.lat, at.lon, 11);
      },
      (err) => setGeo({ kind: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  /* 데이터 로드. 서버가 공간+필터를 하므로 위치/필터가 바뀌면 재요청(상류는 캐시라 0). */
  const load = useCallback(() => {
    if (geo.kind === 'locating') return;
    let alive = true;
    setData({ kind: 'loading' });
    const params = new URLSearchParams();
    if (bounds) {
      params.set('minLat', String(bounds.minLat));
      params.set('maxLat', String(bounds.maxLat));
      params.set('minLon', String(bounds.minLon));
      params.set('maxLon', String(bounds.maxLon));
    } else if (hasRealLocation) {
      params.set('lat', String(origin.lat));
      params.set('lon', String(origin.lon));
    }
    if (filters.kinds.length) params.set('kinds', filters.kinds.join(','));
    if (filters.sido) params.set('sido', filters.sido);
    if (filters.openTodayOnly) params.set('openToday', '1');

    fetch(`/api/museums?${params.toString()}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { code?: string };
          throw Object.assign(new Error('upstream'), { code: body.code });
        }
        return r.json() as Promise<MuseumsResponse>;
      })
      .then((json) => {
        if (!alive) return;
        setData({ kind: 'ready', data: json });
        setLastReady(json);
      })
      .catch((e: { code?: string }) => {
        if (alive) setData({ kind: 'error', code: e?.code });
      });
    return () => {
      alive = false;
    };
  }, [filters, bounds, hasRealLocation, origin.lat, origin.lon, geo.kind]);

  useEffect(() => load(), [load]);

  const shown = data.kind === 'ready' ? data.data : lastReady;
  const museums: MuseumWithDistance[] = shown?.museums ?? [];
  const counts = shown?.counts ?? null;
  const meta = shown?.meta ?? null;
  const isLoading = data.kind === 'loading';
  const hasEverLoaded = shown !== null;

  /* ⌘K / Ctrl+K 토글. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /* ESC: 상세 닫기(팔레트가 위면 팔레트가 먼저 먹음, 입력창 포커스면 무시). */
  useEffect(() => {
    if (!selectedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || paletteOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId]);

  /* 팔레트 최초 오픈 시 전국 이름 인덱스 1회 지연 로딩. */
  useEffect(() => {
    if (!paletteOpen || index || indexLoading) return;
    setIndexLoading(true);
    fetch('/api/museums/index')
      .then((r) => (r.ok ? (r.json() as Promise<{ items: MuseumIndexItem[] }>) : Promise.reject()))
      .then((j) => setIndex(j.items))
      .catch(() => setIndex(null))
      .finally(() => setIndexLoading(false));
  }, [paletteOpen, index, indexLoading]);

  /* 팔레트에서 박물관 선택. 목록 밖이면 단건 조회로 합류. */
  const selectFromPalette = useCallback(
    async (id: string) => {
      setPaletteOpen(false);
      if (museums.some((m) => m.id === id)) {
        setExtra(null);
        setSelectedId(id);
        return;
      }
      try {
        const res = await fetch(`/api/museums/${id}`);
        if (!res.ok) return;
        const { museum } = (await res.json()) as { museum: MuseumWithDistance };
        const distanceKm = Math.round(haversineKm(origin, { lat: museum.lat, lon: museum.lon }) * 10) / 10;
        setExtra({ ...museum, distanceKm });
        setSelectedId(id);
        flyToPoint(museum.lat, museum.lon, 13);
      } catch {
        // 단건 조회 실패는 조용히 무시(팔레트만 닫힘).
      }
    },
    [museums, origin, flyToPoint],
  );

  const merged: MuseumWithDistance[] = useMemo(
    () => (extra && !museums.some((m) => m.id === extra.id) ? [extra, ...museums] : museums),
    [museums, extra],
  );

  const points: MapPoint[] = useMemo(
    () => merged.map((m) => ({ id: m.id, lon: m.lon, lat: m.lat, title: m.title, state: m.openToday })),
    [merged],
  );

  const selected = merged.find((m) => m.id === selectedId) ?? null;

  const mode = meta?.mode ?? (bounds ? 'bounds' : hasRealLocation ? 'location' : 'fallback');
  const showDistance = mode === 'location';

  const kindCount = (k: string) => counts?.kind.find((c) => c.key === k)?.count ?? 0;
  const sidoCount = (k: string) => counts?.sido.find((c) => c.key === k)?.count ?? 0;

  const handleUserMoveEnd = useCallback((b: MapBounds) => setBounds(b), []);

  const onToggleKind = useCallback(
    (k: MuseumKind) => setFilters((f) => ({ ...f, kinds: toggleKind(f.kinds, k) })),
    [],
  );
  const onToggleOpenToday = useCallback(
    () => setFilters((f) => ({ ...f, openTodayOnly: !f.openTodayOnly })),
    [],
  );

  const toggleSido = useCallback(
    (key: string) => {
      const selecting = filters.sido !== key;
      setFilters((f) => ({ ...f, sido: f.sido === key ? null : key }));
      if (selecting) {
        const opt = SIDO_OPTIONS.find((o) => o.key === key);
        if (opt) {
          setBounds(null);
          flyToPoint(opt.center.lat, opt.center.lon, 10);
        }
      }
    },
    [filters.sido, flyToPoint],
  );

  const resetToNearest = useCallback(() => {
    setBounds(null);
    flyToPoint(origin.lat, origin.lon, 11);
  }, [origin.lat, origin.lon, flyToPoint]);

  const excluded = meta?.excludedByOpenToday;

  // ★ 목록/상세 결합 해제: 상세(휴관일) 병합률이 낮으면 "오늘 여는가"를 신뢰할 수 없다. 그때는
  // 필터를 비활성화하고 이유를 밝힌다 — 조용히 전부 unknown 으로 두고 0건을 뱉지 않기 위함(팀 지시).
  // meta 가 아직 없으면(첫 로드) 판정 가능으로 낙관한다.
  const openJudgeable = (meta?.introCoverage ?? 1) >= OPEN_JUDGE_MIN;
  // 판정 불가 상태로 떨어지면 켜져 있던 필터를 끈다(0건 오인 방지).
  useEffect(() => {
    if (!openJudgeable && filters.openTodayOnly) setFilters((f) => ({ ...f, openTodayOnly: false }));
  }, [openJudgeable, filters.openTodayOnly]);

  return (
    <div className="flex h-dvh flex-col">
      {/* 상단 바 */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold">
          <Landmark className="size-4 text-primary" />
          코리아뮤지엄
        </Link>
        <div className="flex items-center gap-2">
          {meta && (
            <span className="hidden text-[11px] text-muted-foreground sm:inline">
              전국 {meta.total.toLocaleString()}곳
            </span>
          )}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
            aria-label="박물관 검색 및 필터 열기"
          >
            <Search className="size-3.5" />
            <span className="hidden sm:inline">검색</span>
            <kbd className="hidden rounded border border-border bg-muted px-1 font-sans text-[10px] sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>
      </header>

      {/* 필터 */}
      <div className="space-y-1.5 border-b border-border px-4 py-2">
        <ChipRow label="상태">
          {/* 킬러 필터 — 오늘 여는 곳. 눈에 띄는 톤. 운영정보 수집 중이면 비활성화. */}
          {openJudgeable ? (
            <Chip active={filters.openTodayOnly} tone="green" onClick={onToggleOpenToday}>
              <Clock className="size-3" />
              오늘 여는 곳
              {counts && <Count>{counts.openToday.open}</Count>}
            </Chip>
          ) : (
            <span
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground/60"
              title="운영정보(휴관일)를 아직 불러오지 못해 오늘 개관 여부를 판정할 수 없습니다"
            >
              <Clock className="size-3" />
              오늘 여는 곳
              <span className="text-[10px]">· 판정 불가</span>
            </span>
          )}
        </ChipRow>
        <ChipRow label="종류">
          {KIND_OPTIONS.map((o) => (
            <Chip key={o.key} active={filters.kinds.includes(o.key)} onClick={() => onToggleKind(o.key)}>
              {o.label}
              {counts && <Count>{kindCount(o.key)}</Count>}
            </Chip>
          ))}
        </ChipRow>
        <ChipRow label="지역">
          {SIDO_OPTIONS.map((o) => (
            <Chip key={o.key} active={filters.sido === o.key} onClick={() => toggleSido(o.key)}>
              {o.label}
              {counts && <Count>{sidoCount(o.key)}</Count>}
            </Chip>
          ))}
          {hasAnyFilter(filters) && (
            <button
              type="button"
              onClick={() => setFilters(EMPTY_FILTERS)}
              className="ml-1 shrink-0 rounded-full px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              초기화
            </button>
          )}
        </ChipRow>
      </div>

      {/* 위치 상태 배너 */}
      {geo.kind !== 'granted' && geo.kind !== 'locating' && (
        <div className="flex items-center gap-2 border-b border-border bg-amber-500/10 px-4 py-2 text-xs text-amber-300">
          <MapPin className="size-3.5 shrink-0" />
          <span className="flex-1">
            {geo.kind === 'denied'
              ? '위치 권한이 거부되어 서울 기준으로 보여줍니다.'
              : geo.kind === 'unsupported'
                ? '이 브라우저는 위치를 지원하지 않아 서울 기준으로 보여줍니다.'
                : '위치를 확인할 수 없어 서울 기준으로 보여줍니다.'}
          </span>
          {geo.kind !== 'unsupported' && (
            <button
              type="button"
              onClick={requestLocation}
              className="shrink-0 rounded-full border border-amber-400/40 px-2 py-0.5 font-medium hover:bg-amber-400/10"
            >
              내 위치로
            </button>
          )}
        </div>
      )}

      {/* 본체: 데스크톱 좌우 분할(목록 좌측 고정폭 + 지도 우측 전폭), 모바일 상하. 전폭. */}
      <div className="flex min-h-0 w-full flex-1 flex-col sm:flex-row-reverse">
        {/* 지도 */}
        <div className="relative h-[42dvh] w-full shrink-0 sm:h-auto sm:flex-1">
          {hasEverLoaded && (
            <MuseumsMap
              points={points}
              center={origin}
              isUserLocation={hasRealLocation}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onUserMoveEnd={handleUserMoveEnd}
              flyTo={flyTo}
            />
          )}
          {/* 범례: 핀 색의 의미(오늘 개관/휴관/확인 필요) */}
          {hasEverLoaded && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur">
              <LegendDot color={OPEN_STATE_COLOR.open} label="오늘 개관" />
              <LegendDot color={OPEN_STATE_COLOR.closed} label="오늘 휴관" />
              <LegendDot color={OPEN_STATE_COLOR.unknown} label="확인 필요" />
            </div>
          )}
          {!hasEverLoaded && data.kind !== 'error' && (
            <div className="flex size-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {geo.kind === 'locating' ? '내 위치 확인 중…' : '박물관 불러오는 중…'}
            </div>
          )}
          {hasEverLoaded && isLoading && (
            <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card/90 px-3 py-1 text-xs text-muted-foreground shadow-sm backdrop-blur">
              <Loader2 className="size-3.5 animate-spin" />
              불러오는 중…
            </div>
          )}
          {!hasEverLoaded && data.kind === 'error' && (
            <div className="flex size-full flex-col items-center justify-center gap-2 p-6 text-center text-sm">
              <AlertCircle className="size-6 text-destructive" />
              <p className="text-muted-foreground">지금 박물관 정보를 불러오지 못했습니다.</p>
              <button
                type="button"
                onClick={() => load()}
                className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>

        {/* 리스트 */}
        <div className="flex min-h-0 flex-1 flex-col sm:w-[26rem] sm:flex-none sm:border-r sm:border-border">
          <div className="flex items-baseline justify-between px-4 py-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {mode === 'bounds' ? '이 지도 영역' : '주변 박물관'}
            </span>
            {shown && (
              <span>
                {museums.length}곳
                {mode === 'location' ? ' · 가까운 순' : mode === 'bounds' ? ' · 이 영역' : ' · 서울 기준'}
              </span>
            )}
          </div>

          {/* 오늘 여는 곳 필터 켰을 때 제외 고지(조용히 숨기지 않는다) */}
          {filters.openTodayOnly && excluded && (excluded.closed > 0 || excluded.unknown > 0) && (
            <p className="px-4 pb-1 text-[11px] text-amber-300/90">
              오늘 휴관 {excluded.closed}곳
              {excluded.unknown > 0 && `, 판정 불가 ${excluded.unknown}곳`}은 제외했습니다.
            </p>
          )}

          {meta?.truncated && (
            <p className="px-4 pb-1 text-[11px] text-muted-foreground">
              {mode === 'bounds' ? '이 영역' : '조건'}에 맞는 {meta.matched.toLocaleString()}곳 중 가까운{' '}
              {museums.length}곳
            </p>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {hasEverLoaded && !isLoading && museums.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <Landmark className="size-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">
                  {filters.openTodayOnly
                    ? '이 조건에서 오늘 여는 곳이 없습니다.'
                    : mode === 'bounds'
                      ? '이 지도 영역에는 조건에 맞는 박물관이 없습니다.'
                      : '조건에 맞는 박물관이 없습니다.'}
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {mode === 'bounds' && (
                    <button
                      type="button"
                      onClick={resetToNearest}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                    >
                      가장 가까운 곳으로
                    </button>
                  )}
                  {hasAnyFilter(filters) && (
                    <button
                      type="button"
                      onClick={() => setFilters(EMPTY_FILTERS)}
                      className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent"
                    >
                      필터 초기화
                    </button>
                  )}
                </div>
              </div>
            )}
            {museums.map((m) => (
              <MuseumCard
                key={m.id}
                museum={m}
                showDistance={showDistance}
                selected={m.id === selectedId}
                onSelect={() => setSelectedId(m.id)}
              />
            ))}
            {!hasEverLoaded &&
              isLoading &&
              geo.kind !== 'locating' &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[92px] animate-pulse rounded-xl bg-muted" />
              ))}
          </div>

          {/* 상세 병합률(부분 결측) 정직 고지. 목록·지도는 정상이고 운영정보만 결측임을 명확히. */}
          {meta && !openJudgeable && (
            <p className="border-t border-amber-500/20 bg-amber-500/5 px-4 py-1.5 text-[11px] text-amber-300/90">
              운영정보(휴관일)를 불러오지 못해 <b>&lsquo;오늘 여는 곳&rsquo;을 판정할 수 없습니다</b>. 목록·위치는
              정상입니다(수집률 {Math.round(meta.introCoverage * 100)}%). 잠시 후 자동으로 채워집니다.
            </p>
          )}
          {meta && openJudgeable && meta.introCoverage < 0.95 && (
            <p className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
              휴관·관람 정보를 아직 다 불러오지 못했습니다(수집률 {Math.round(meta.introCoverage * 100)}%).
              해당 항목은 &lsquo;확인 필요&rsquo;로 표시되며 잠시 후 채워집니다.
            </p>
          )}
        </div>
      </div>

      {/* 상세 시트 */}
      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-20 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[26rem]">
          <MuseumDetail museum={selected} showDistance={showDistance} onClose={() => setSelectedId(null)} />
        </div>
      )}

      {/* 커맨드 팔레트(⌘K) */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        index={index}
        indexLoading={indexLoading}
        filters={filters}
        onToggleKind={onToggleKind}
        onToggleOpenToday={onToggleOpenToday}
        onToggleSido={toggleSido}
        onSelectMuseum={selectFromPalette}
      />
    </div>
  );
}

/* ── 작은 UI 조각들 ───────────────────────────────────────────── */

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-[11px] font-medium text-muted-foreground">{label}</span>
      <div className="scrollbar-none flex gap-1.5 overflow-x-auto">{children}</div>
    </div>
  );
}

function Chip({
  active,
  tone = 'primary',
  onClick,
  children,
}: {
  active: boolean;
  tone?: 'primary' | 'green';
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeCls =
    tone === 'green'
      ? 'border-green-500/50 bg-green-500/15 text-green-400'
      : 'border-primary bg-primary text-primary-foreground';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors',
        active ? activeCls : 'border-border text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="opacity-60">{children}</span>;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}
