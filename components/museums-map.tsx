'use client';

import maplibregl, { type Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

import type { LatLon } from '@/lib/geo';
import type { MapBounds } from '@/lib/types';
import type { OpenState } from '@/lib/restday';
import { OPEN_STATE_COLOR } from '@/lib/museum-ui';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * 박물관 지도. MapLibre **v5** — v6 는 Turbopack 에서 워커 로딩이 실패해 지도가 조용히 안 뜬다
 * (메모리 기록). 좌표는 WGS84(lon,lat)를 API 가 직접 준다.
 *
 * ★ 핀 색 = 오늘 개관 상태(open·unknown(추정 개관) 초록 / closed 빨강). 이 앱의 핵심 값이 "오늘
 *   여는가"라 지도에서 바로 읽히는 게 맞다. 대신 범례를 함께 그려 색의 의미를 명시한다(범례 없는
 *   다색 지도가 오히려 헷갈린다는 함정을 범례로 방어).
 */

export interface MapPoint {
  id: string;
  lon: number;
  lat: number;
  title: string;
  state: OpenState;
}

/** 전시 오버레이 포인트(좌표 보유분만). 박물관과 구분되는 보라 핀. */
export interface ExhibitionPoint {
  id: string;
  lon: number;
  lat: number;
  title: string;
}

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
const KOREA_BOUNDS: [[number, number], [number, number]] = [
  [125.9, 33.1],
  [129.6, 38.6],
];
const FIT_PADDING = { top: 40, right: 40, bottom: 40, left: 40 };
const SOURCE = 'museums';

function toGeoJson(points: MapPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, title: p.title, state: p.state },
    })),
  };
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

const EX_SOURCE = 'exhibitions';
const EX_COLOR = '#a855f7'; // 전시 = 보라(박물관 개관상태 색과 구분)

function exToGeoJson(points: ExhibitionPoint[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points.map((p) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, title: p.title },
    })),
  };
}

/** 상태별 색을 지도 표현식으로. */
const STATE_COLOR_EXPR: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'state'],
  'open',
  OPEN_STATE_COLOR.open,
  'closed',
  OPEN_STATE_COLOR.closed,
  OPEN_STATE_COLOR.unknown,
];

/** 지도 이동 목적지(프로그램 이동). key 가 바뀔 때만 실제로 이동한다(사용자 조작과 안 싸우게). */
export interface FlyTarget {
  lat: number;
  lon: number;
  zoom: number;
  key: number;
}

export function MuseumsMap({
  points,
  exhibitionPoints,
  center,
  isUserLocation,
  selectedId,
  selectedExId,
  onSelect,
  onSelectExhibition,
  onUserMoveEnd,
  flyTo,
}: {
  points: MapPoint[];
  exhibitionPoints?: ExhibitionPoint[];
  center: LatLon;
  isUserLocation: boolean;
  selectedId: string | null;
  selectedExId?: string | null;
  onSelect: (id: string) => void;
  onSelectExhibition?: (id: string) => void;
  onUserMoveEnd?: (b: MapBounds) => void;
  flyTo?: FlyTarget | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const fittedRef = useRef(false);
  const onSelectRef = useRef(onSelect);
  const onUserMoveEndRef = useRef(onUserMoveEnd);
  const pointsRef = useRef(points);
  const exPointsRef = useRef(exhibitionPoints ?? []);
  const centerRef = useRef(center);
  const flyKeyRef = useRef<number | null>(null);
  const programMoveRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSelectExRef = useRef(onSelectExhibition);

  useEffect(() => void (onSelectRef.current = onSelect), [onSelect]);
  useEffect(() => void (onSelectExRef.current = onSelectExhibition), [onSelectExhibition]);
  useEffect(() => void (onUserMoveEndRef.current = onUserMoveEnd), [onUserMoveEnd]);
  useEffect(() => void (pointsRef.current = points), [points]);
  useEffect(() => void (exPointsRef.current = exhibitionPoints ?? []), [exhibitionPoints]);
  useEffect(() => void (centerRef.current = center), [center]);

  const readBounds = (map: MapLibreMap): MapBounds => {
    const b = map.getBounds();
    return { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast() };
  };

  /* 지도 생성 — 한 번만. */
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      bounds: KOREA_BOUNDS,
      fitBoundsOptions: { padding: FIT_PADDING },
      minZoom: 4,
      maxZoom: 18,
      attributionControl: false,
      localIdeographFontFamily: "'Noto Sans KR', 'Noto Sans', sans-serif",
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('load', () => {
      map.addSource(SOURCE, { type: 'geojson', data: toGeoJson(pointsRef.current) });

      map.addLayer({
        id: 'museum-selected',
        type: 'circle',
        source: SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: {
          'circle-radius': 13,
          'circle-color': 'transparent',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: 'museum-point',
        type: 'circle',
        source: SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 15, 9],
          'circle-color': STATE_COLOR_EXPR,
          'circle-opacity': 0.92,
          'circle-stroke-color': '#0b0f19',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'museum-label',
        type: 'symbol',
        source: SOURCE,
        minzoom: 11,
        layout: {
          'text-field': ['get', 'title'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 9,
          'text-allow-overlap': false,
        },
        paint: {
          'text-color': '#e5e7eb',
          'text-halo-color': '#0b0f19',
          'text-halo-width': 1.2,
        },
      });

      // 전시 오버레이 소스·레이어(박물관 위에). 보라 핀 + 라벨 + 선택 강조.
      map.addSource(EX_SOURCE, { type: 'geojson', data: exToGeoJson(exPointsRef.current) });
      map.addLayer({
        id: 'ex-selected',
        type: 'circle',
        source: EX_SOURCE,
        filter: ['==', ['get', 'id'], ''],
        paint: { 'circle-radius': 13, 'circle-color': 'transparent', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
      });
      map.addLayer({
        id: 'ex-point',
        type: 'circle',
        source: EX_SOURCE,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5, 15, 9],
          'circle-color': EX_COLOR,
          'circle-opacity': 0.92,
          'circle-stroke-color': '#0b0f19',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'ex-label',
        type: 'symbol',
        source: EX_SOURCE,
        minzoom: 12,
        layout: {
          'text-field': ['get', 'title'],
          'text-size': 11,
          'text-offset': [0, 1.2],
          'text-anchor': 'top',
          'text-max-width': 9,
          'text-allow-overlap': false,
        },
        paint: { 'text-color': '#e9d5ff', 'text-halo-color': '#0b0f19', 'text-halo-width': 1.2 },
      });

      loadedRef.current = true;
      map.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData(toGeoJson(pointsRef.current));
      map.getSource<maplibregl.GeoJSONSource>(EX_SOURCE)?.setData(exToGeoJson(exPointsRef.current));
    });

    for (const layer of ['museum-point', 'museum-label']) {
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectRef.current(id);
      });
      map.on('mouseenter', layer, () => void (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => void (map.getCanvas().style.cursor = ''));
    }
    for (const layer of ['ex-point', 'ex-label']) {
      map.on('click', layer, (e) => {
        const id = e.features?.[0]?.properties?.id as string | undefined;
        if (id) onSelectExRef.current?.(id);
      });
      map.on('mouseenter', layer, () => void (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', layer, () => void (map.getCanvas().style.cursor = ''));
    }

    map.on('moveend', (e) => {
      const userGesture = !!(e as { originalEvent?: unknown }).originalEvent;
      if (!userGesture || programMoveRef.current) {
        programMoveRef.current = false;
        return;
      }
      if (!onUserMoveEndRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => onUserMoveEndRef.current?.(readBounds(map)), 250);
    });

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box || box.width < 1 || box.height < 1) return;
      map.resize();
      if (fittedRef.current) return;
      fittedRef.current = true;
      const c = centerRef.current;
      map.easeTo({ center: [c.lon, c.lat], zoom: 11, duration: 0 });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      map.remove();
      mapRef.current = null;
      loadedRef.current = false;
      fittedRef.current = false;
    };
  }, []);

  /* 프로그램 이동: flyTo.key 가 바뀔 때만 easeTo. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo || flyKeyRef.current === flyTo.key) return;
    flyKeyRef.current = flyTo.key;
    programMoveRef.current = true;
    fittedRef.current = true;
    map.easeTo({ center: [flyTo.lon, flyTo.lat], zoom: flyTo.zoom, duration: 600 });
  }, [flyTo]);

  /* 포인트 갱신. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.getSource<maplibregl.GeoJSONSource>(SOURCE)?.setData(points.length ? toGeoJson(points) : EMPTY);
  }, [points]);

  /* 전시 오버레이 갱신. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    const ex = exhibitionPoints ?? [];
    map.getSource<maplibregl.GeoJSONSource>(EX_SOURCE)?.setData(ex.length ? exToGeoJson(ex) : EMPTY);
  }, [exhibitionPoints]);

  /* 중심 이동 + (실제 위치일 때만) 파란 '내 위치' 점. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let marker: maplibregl.Marker | null = null;
    if (isUserLocation) {
      const el = document.createElement('div');
      el.className = 'kr-user-dot';
      marker = new maplibregl.Marker({ element: el }).setLngLat([center.lon, center.lat]).addTo(map);
    }
    if (loadedRef.current && !fittedRef.current) {
      fittedRef.current = true;
      map.easeTo({ center: [center.lon, center.lat], zoom: 11, duration: 400 });
    }
    return () => void marker?.remove();
  }, [center, isUserLocation]);

  /* 선택 강조 + 화면으로 끌어오기. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter('museum-selected', ['==', ['get', 'id'], selectedId ?? '']);
    if (!selectedId) return;
    const hit = pointsRef.current.find((p) => p.id === selectedId);
    if (hit) map.easeTo({ center: [hit.lon, hit.lat], zoom: Math.max(map.getZoom(), 13), duration: 500 });
  }, [selectedId]);

  /* 전시 선택 강조 + 화면으로 끌어오기. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    map.setFilter('ex-selected', ['==', ['get', 'id'], selectedExId ?? '']);
    if (!selectedExId) return;
    const hit = exPointsRef.current.find((p) => p.id === selectedExId);
    if (hit) map.easeTo({ center: [hit.lon, hit.lat], zoom: Math.max(map.getZoom(), 13), duration: 500 });
  }, [selectedExId]);

  return <div ref={containerRef} className="size-full" />;
}
