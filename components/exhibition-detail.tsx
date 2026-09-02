'use client';

import { CalendarDays, Image as ImageIcon, MapPin, X } from 'lucide-react';

import type { ExhibitionWithDistance } from '@/lib/types';

/** YYYYMMDD → YYYY.MM.DD */
function fmt(ymd: string): string {
  return ymd.length === 8 ? `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}` : ymd;
}

/**
 * 전시 상세 시트. 공연전시 API 는 관람시간·입장료를 안 주므로(period2 스키마) 있는 것만 정직하게:
 * 제목·기간·장소·지역·이미지·길찾기(좌표 있을 때). "지금 하는 전시"의 최소 정보.
 */
export function ExhibitionDetail({
  exhibition,
  onClose,
}: {
  exhibition: ExhibitionWithDistance;
  onClose: () => void;
}) {
  const e = exhibition;
  return (
    <div className="max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-purple-500/30 bg-card shadow-2xl sm:max-h-[75dvh] sm:rounded-2xl">
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <ImageIcon className="size-3.5 shrink-0 text-purple-400" />
            <span className="text-[11px] font-medium text-purple-400">전시</span>
          </div>
          <h2 className="mt-0.5 text-base font-bold leading-snug">{e.title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="닫기"
          className="shrink-0 rounded-full p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="space-y-4 px-4 py-4">
        {e.image && (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN, next/image 불필요
          <img
            src={e.image}
            alt=""
            loading="lazy"
            className="max-h-72 w-full rounded-lg object-contain bg-muted/40"
            onError={(ev) => {
              (ev.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}

        <Row icon={<CalendarDays className="size-4" />} label="기간">
          {fmt(e.startYmd)} ~ {fmt(e.endYmd)}
        </Row>
        {e.place && (
          <Row icon={<MapPin className="size-4" />} label="장소">
            {e.place}
            {(e.area || e.sigungu) && (
              <span className="text-muted-foreground">
                {' '}
                · {[e.area, e.sigungu].filter(Boolean).join(' ')}
              </span>
            )}
          </Row>
        )}

        <div className="flex flex-wrap gap-2 pt-1">
          {e.lat != null && e.lon != null ? (
            <a
              href={`https://map.kakao.com/link/to/${encodeURIComponent(e.place || e.title)},${e.lat},${e.lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <MapPin className="size-3" />
              길찾기
            </a>
          ) : (
            <span className="text-[11px] text-muted-foreground">이 전시는 좌표가 없어 지도에 표시되지 않습니다.</span>
          )}
          <a
            href={`https://search.naver.com/search.naver?query=${encodeURIComponent(e.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            검색
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="mt-0.5 shrink-0 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <span className="mr-2 text-xs font-medium text-muted-foreground">{label}</span>
        <span className="break-words">{children}</span>
      </div>
    </div>
  );
}
