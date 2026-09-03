'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Clock, Image as ImageIcon, Landmark, Loader2, MapPin, Search } from 'lucide-react';

import type { LatLon } from '@/lib/geo';
import { SEOUL, haversineKm } from '@/lib/geo';
import type {
  ExhibitionWithDistance,
  ExhibitionsResponse,
  MapBounds,
  MuseumIndexItem,
  MuseumWithDistance,
  MuseumsResponse,
} from '@/lib/types';
import type { Timeframe } from '@/lib/exhibitions';
import type { MuseumKind } from '@/lib/museums';
import { ExhibitionDetail } from '@/components/exhibition-detail';
import {
  EMPTY_FILTERS,
  KIND_OPTIONS,
  SIDO_OPTIONS,
  hasAnyFilter,
  toggleKind,
  type Filters,
} from '@/lib/facets';
import { CLOSED_RING_COLOR, KIND_COLOR, OPEN_INFO_NOTICE, kindColorFor } from '@/lib/museum-ui';
import { cn } from '@/lib/utils';
import { MuseumCard } from '@/components/museum-card';
import { MuseumDetail } from '@/components/museum-detail';
import { EX_COLOR, EX_RING_COLOR, MuseumsMap, type FlyTarget, type MapPoint } from '@/components/museums-map';
import { CommandPalette } from '@/components/command-palette';


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
  // 축 2 — 지금 하는 전시(오버레이). 기본 꺼짐.
  const [showEx, setShowEx] = useState(false);
  const [exTf, setExTf] = useState<Timeframe>('today');
  const [exData, setExData] = useState<ExhibitionsResponse | null>(null);
  const [exLoading, setExLoading] = useState(false);
  const [exError, setExError] = useState(false);
  const [selectedExId, setSelectedExId] = useState<string | null>(null);
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

  /* ESC: 상세(박물관/전시) 닫기(팔레트가 위면 팔레트가 먼저 먹음, 입력창 포커스면 무시). */
  useEffect(() => {
    if (!selectedId && !selectedExId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || paletteOpenRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable) return;
      setSelectedId(null);
      setSelectedExId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, selectedExId]);

  // 상세는 하나만: 박물관 선택 시 전시 상세 닫고, 전시 선택 시 박물관 상세 닫는다.
  const selectMuseum = useCallback((id: string | null) => {
    setSelectedExId(null);
    setSelectedId(id);
  }, []);
  const selectExhibition = useCallback((id: string | null) => {
    setSelectedId(null);
    setSelectedExId(id);
  }, []);

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
      setSelectedExId(null); // 박물관 선택 → 전시 상세 닫기
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
    () =>
      merged.map((m) => ({
        id: m.id,
        lon: m.lon,
        lat: m.lat,
        title: m.title,
        kind: m.kind,
        state: m.openToday,
      })),
    [merged],
  );

  /* 전시 로드 — 토글 켜졌을 때만. 시간축(exTf)·실제 위치가 바뀌면 재요청. 박물관 축과 독립. */
  useEffect(() => {
    if (!showEx || geo.kind === 'locating') return;
    let alive = true;
    setExLoading(true);
    setExError(false);
    const params = new URLSearchParams({ tf: exTf });
    if (hasRealLocation) {
      params.set('lat', String(origin.lat));
      params.set('lon', String(origin.lon));
    }
    fetch(`/api/exhibitions?${params.toString()}`)
      .then((r) => (r.ok ? (r.json() as Promise<ExhibitionsResponse>) : Promise.reject()))
      .then((j) => alive && setExData(j))
      .catch(() => alive && setExError(true))
      .finally(() => alive && setExLoading(false));
    return () => {
      alive = false;
    };
  }, [showEx, exTf, hasRealLocation, origin.lat, origin.lon, geo.kind]);

  const exhibitionPoints = useMemo(
    () =>
      showEx && exData
        ? exData.mapped.map((e) => ({ id: e.id, lon: e.lon as number, lat: e.lat as number, title: e.title }))
        : [],
    [showEx, exData],
  );
  // 목록에 보여줄 전시(좌표 보유 + 목록 전용 합쳐, 마감/거리 정렬은 서버가 함).
  const exhibitionList: ExhibitionWithDistance[] = useMemo(
    () => (showEx && exData ? [...exData.mapped, ...exData.listOnly] : []),
    [showEx, exData],
  );
  const selectedEx = exhibitionList.find((e) => e.id === selectedExId) ?? null;

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

  // '오늘 여는 곳' 칩 카운트: 확정 개관 + 추정 개관(unknown). closed 만 뺀 수.
  const openTodayCount = counts ? counts.openToday.open + counts.openToday.unknown : null;

  return (
    <div className="flex h-dvh flex-col">
      {/* 상단 바 */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <Link href="/" className="flex items-center gap-2 text-sm font-bold">
          <Landmark className="size-4 text-primary" />
          박물관나우
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
          {/* 킬러 필터 — 오늘 여는 곳(추정 개관 포함, 휴관 확실한 곳만 제외). 눈에 띄는 톤. */}
          <Chip active={filters.openTodayOnly} tone="green" onClick={onToggleOpenToday}>
            <Clock className="size-3" />
            오늘 여는 곳
            {openTodayCount !== null && <Count>{openTodayCount}</Count>}
          </Chip>
          <span className="mx-0.5 w-px shrink-0 self-stretch bg-border" aria-hidden />
          {/* 축 2 — 지금 하는 전시(오버레이 토글, 보라 톤; 지도 핀은 흰 채움+보라 링). */}
          <Chip active={showEx} tone="purple" onClick={() => setShowEx((v) => !v)}>
            <ImageIcon className="size-3" />
            지금 하는 전시
            {showEx && exData && <Count>{exData.meta.total}</Count>}
          </Chip>
        </ChipRow>
        {/* 전시 시간축(토글 켜졌을 때만). */}
        {showEx && (
          <ChipRow label="전시">
            {(['today', 'weekend', 'month'] as const).map((tf) => (
              <Chip key={tf} active={exTf === tf} tone="purple" onClick={() => setExTf(tf)}>
                {tf === 'today' ? '오늘' : tf === 'weekend' ? '이번 주말' : '이번 달'}
              </Chip>
            ))}
            {exData && (
              <span className="ml-1 self-center text-[11px] text-muted-foreground">
                {exData.meta.total}건
                {exData.meta.noCoords > 0 && ` · 좌표없음 ${exData.meta.noCoords}건은 목록만`}
              </span>
            )}
          </ChipRow>
        )}
        {/* 종류 칩 = 지도 핀 색 범례 겸용(dot). 기타(other)는 fallback 이라 0건이면 숨긴다. */}
        <ChipRow label="종류">
          {KIND_OPTIONS.filter((o) => o.key !== 'other' || kindCount(o.key) > 0).map((o) => (
            <Chip
              key={o.key}
              active={filters.kinds.includes(o.key)}
              dotColor={kindColorFor(o.key)}
              onClick={() => onToggleKind(o.key)}
            >
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
              exhibitionPoints={exhibitionPoints}
              center={origin}
              isUserLocation={hasRealLocation}
              selectedId={selectedId}
              selectedExId={selectedExId}
              onSelect={selectMuseum}
              onSelectExhibition={selectExhibition}
              onUserMoveEnd={handleUserMoveEnd}
              flyTo={flyTo}
            />
          )}
          {/* 범례: 종류색은 상단 칩 dot 이 맡는다. 여기엔 휴관 표기(흐림+빨간 링)와 전시 오버레이만. */}
          {hasEverLoaded && (
            <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex flex-col gap-1 rounded-lg border border-border bg-card/90 px-2.5 py-2 text-[11px] shadow-sm backdrop-blur">
              <LegendDot color={KIND_COLOR.other} ring={CLOSED_RING_COLOR} dim label="오늘 휴관 (흐림 + 빨간 링)" />
              {showEx && <LegendDot color={EX_COLOR} ring={EX_RING_COLOR} label="지금 하는 전시" />}
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

          {/* 오늘 여는 곳 필터 켰을 때 제외 고지 */}
          {filters.openTodayOnly && excluded && excluded.closed > 0 && (
            <p className="px-4 pb-1 text-[11px] text-muted-foreground">
              오늘 휴관이 확실한 {excluded.closed}곳은 제외했습니다.
            </p>
          )}

          {meta?.truncated && (
            <p className="px-4 pb-1 text-[11px] text-muted-foreground">
              {mode === 'bounds' ? '이 영역' : '조건'}에 맞는 {meta.matched.toLocaleString()}곳 중 가까운{' '}
              {museums.length}곳
            </p>
          )}

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {/* 축 2 — 지금 하는 전시 섹션(토글 켜졌을 때, 목록 상단). */}
            {showEx && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 pt-1 text-[11px] font-semibold text-purple-300">
                  <ImageIcon className="size-3.5" />
                  지금 하는 전시
                  {exData && <span className="font-normal text-muted-foreground">{exData.meta.total}건</span>}
                </div>
                <p className="text-[10px] text-muted-foreground/70">
                  전시만 표시합니다(공연·음악·뮤지컬 제외). 문화정보 공연전시 데이터.
                </p>
                {exLoading && !exData && <div className="h-16 animate-pulse rounded-xl bg-muted" />}
                {exError && <p className="text-[11px] text-muted-foreground">전시 정보를 불러오지 못했습니다.</p>}
                {exData && exhibitionList.length === 0 && (
                  <p className="py-2 text-[11px] text-muted-foreground">
                    {exTf === 'today' ? '오늘' : exTf === 'weekend' ? '이번 주말' : '이번 달'} 진행 중인 전시가 없습니다.
                  </p>
                )}
                {exhibitionList.slice(0, 60).map((e) => (
                  <ExhibitionRow
                    key={e.id}
                    ex={e}
                    selected={e.id === selectedExId}
                    onSelect={() => selectExhibition(e.id)}
                  />
                ))}
                <div className="!mt-3 border-b border-border pb-1 text-[11px] font-semibold text-foreground">
                  박물관·미술관
                </div>
              </div>
            )}
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
                onSelect={() => selectMuseum(m.id)}
              />
            ))}
            {!hasEverLoaded &&
              isLoading &&
              geo.kind !== 'locating' &&
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-[92px] animate-pulse rounded-xl bg-muted" />
              ))}
          </div>

          {/* 휴관 정보 부분 반영 안내 — 수집률과 무관하게 눈에 안 띄는 한 줄(muted). */}
          {meta && (
            <p className="border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
              {OPEN_INFO_NOTICE}
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

      {/* 전시 상세 시트(박물관과 동일 위치, 하나만 열림). */}
      {selectedEx && (
        <div className="fixed inset-x-0 bottom-0 z-20 sm:inset-auto sm:bottom-4 sm:right-4 sm:w-[26rem]">
          <ExhibitionDetail exhibition={selectedEx} onClose={() => setSelectedExId(null)} />
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
  dotColor,
  onClick,
  children,
}: {
  active: boolean;
  tone?: 'primary' | 'green' | 'purple';
  /** 있으면 칩 앞에 색 dot(종류 칩 = 핀 색 범례 겸용). */
  dotColor?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const activeCls =
    tone === 'green'
      ? 'border-green-500/50 bg-green-500/15 text-green-400'
      : tone === 'purple'
        ? 'border-purple-500/50 bg-purple-500/15 text-purple-300'
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
      {dotColor && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full ring-1 ring-black/30"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {children}
    </button>
  );
}

/** 전시 목록 행(컴팩트). 좌표 없으면 '지도 표시 안 됨' 표기. */
function ExhibitionRow({
  ex,
  selected,
  onSelect,
}: {
  ex: ExhibitionWithDistance;
  selected: boolean;
  onSelect: () => void;
}) {
  const period = `${ex.startYmd.slice(4, 6)}.${ex.startYmd.slice(6, 8)}~${ex.endYmd.slice(4, 6)}.${ex.endYmd.slice(6, 8)}`;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full gap-3 rounded-xl border p-2.5 text-left transition-colors',
        selected ? 'border-purple-500 bg-purple-500/10' : 'border-border bg-card hover:border-purple-500/40 hover:bg-accent',
      )}
    >
      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-muted">
        {ex.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 썸네일
          <img src={ex.image} alt="" loading="lazy" className="size-full object-cover"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            <ImageIcon className="size-6" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="line-clamp-2 text-sm font-semibold leading-snug">{ex.title}</h3>
        <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <MapPin className="size-3 shrink-0" />
          {[ex.place, ex.area].filter(Boolean).join(' · ') || '장소 미상'}
        </p>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="text-purple-300">{period}</span>
          {ex.lat == null && <span className="text-muted-foreground/70">· 지도 표시 안 됨</span>}
        </div>
      </div>
    </button>
  );
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="opacity-60">{children}</span>;
}

function LegendDot({
  color,
  ring,
  dim = false,
  label,
}: {
  color: string;
  ring?: string;
  dim?: boolean;
  label: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span
        className="size-2.5 rounded-full"
        style={{
          backgroundColor: color,
          opacity: dim ? 0.4 : 1,
          boxShadow: ring ? `0 0 0 1.5px ${ring}` : undefined,
        }}
      />
      {label}
    </span>
  );
}
