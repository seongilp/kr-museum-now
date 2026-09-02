'use client';

import { Building2, Clock, Landmark, MapPin, Palette, Image as ImageIcon } from 'lucide-react';

import type { MuseumWithDistance } from '@/lib/types';
import type { MuseumKind } from '@/lib/museums';
import { KIND_LABEL } from '@/lib/museums';
import { openStateBadgeClass, openStateLabel } from '@/lib/museum-ui';
import { cn } from '@/lib/utils';

/**
 * 박물관 카드. 대표사진 + 이름 + 종류 배지 + 지역 + 거리 + **오늘 개관 상태 배지**.
 * 사진이 없으면 종류 아이콘 플레이스홀더. 값이 있는 것만 그린다(없는 걸 "없음"으로 채우지 않음).
 */

const KIND_ICON: Record<MuseumKind, React.ReactNode> = {
  museum: <Landmark className="size-2.5" />,
  gallery: <Palette className="size-2.5" />,
  exhibition: <ImageIcon className="size-2.5" />,
  memorial: <Building2 className="size-2.5" />,
};

export function MuseumCard({
  museum,
  showDistance,
  selected,
  onSelect,
}: {
  museum: MuseumWithDistance;
  showDistance: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'flex w-full gap-3 rounded-xl border p-2.5 text-left transition-colors',
        selected
          ? 'border-primary bg-primary/10'
          : 'border-border bg-card hover:border-primary/40 hover:bg-accent',
      )}
    >
      {/* 썸네일 */}
      <div className="relative size-20 shrink-0 overflow-hidden rounded-lg bg-muted">
        {museum.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN 썸네일, next/image 불필요
          <img
            src={museum.image}
            alt=""
            loading="lazy"
            className="size-full object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        ) : (
          <div className="flex size-full items-center justify-center text-muted-foreground/40">
            {KIND_ICON[museum.kind]}
          </div>
        )}
      </div>

      {/* 본문 */}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{museum.title}</h3>
          <span className="shrink-0 text-xs font-medium text-primary">
            {showDistance ? `${museum.distanceKm}km` : ''}
          </span>
        </div>

        {museum.addr && (
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <MapPin className="size-3 shrink-0" />
            {museum.addr}
          </p>
        )}

        <div className="mt-0.5 flex flex-wrap items-center gap-1">
          {/* 오늘 개관 상태 — 가장 중요한 신호라 맨 앞에. */}
          <span
            className={cn(
              'inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[10px] font-medium',
              openStateBadgeClass(museum.openToday),
            )}
          >
            <Clock className="size-2.5" />
            {openStateLabel(museum.openToday)}
          </span>
          <span className="inline-flex items-center gap-0.5 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            {KIND_ICON[museum.kind]}
            {KIND_LABEL[museum.kind]}
          </span>
        </div>
      </div>
    </button>
  );
}
