'use client';

import { Clock, CircleDollarSign, Info, Landmark, MapPin, ParkingCircle, Phone, X } from 'lucide-react';

import type { MuseumWithDistance } from '@/lib/types';
import { KIND_LABEL } from '@/lib/museums';
import { openStateBadgeClass, openStateLabel } from '@/lib/museum-ui';
import { cn } from '@/lib/utils';

/**
 * 박물관 상세 시트. 카탈로그에 담긴 필드를 그대로 보여 준다(추가 상류 호출 없음).
 *
 * ★ 정직성 규칙:
 *  - **휴관일 원문(restRaw)을 항상 함께 보여준다.** 판정('오늘 개관/휴관/확인 필요')이 틀려도
 *    사용자가 직접 읽고 판단할 수 있어야 한다.
 *  - 판정 불가(unknown)는 회색으로 명확히 구분한다(초록/개관처럼 보이지 않게).
 *  - 공휴일 판정은 하지 않는다(캘린더 없음). 그 한계를 고지문으로 드러낸다.
 *  - 값 없는 필드는 그 줄 자체를 그리지 않는다(빈 항목을 만들지 않음).
 */
export function MuseumDetail({
  museum,
  showDistance,
  onClose,
}: {
  museum: MuseumWithDistance;
  showDistance: boolean;
  onClose: () => void;
}) {
  return (
    <div className="max-h-[80dvh] overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl sm:max-h-[75dvh] sm:rounded-2xl">
      {/* 헤더 */}
      <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Landmark className="size-3.5 shrink-0 text-primary" />
            <span className="text-[11px] font-medium text-primary">{KIND_LABEL[museum.kind]}</span>
          </div>
          <h2 className="mt-0.5 truncate text-base font-bold">{museum.title}</h2>
          {museum.addr && (
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3 shrink-0" />
              <span className="truncate">{museum.addr}</span>
              {showDistance && <span className="shrink-0 text-primary"> · {museum.distanceKm}km</span>}
            </p>
          )}
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
        {/* 대표사진 */}
        {museum.image && (
          // eslint-disable-next-line @next/next/no-img-element -- 외부 CDN, next/image 불필요
          <img
            src={museum.image}
            alt=""
            loading="lazy"
            className="h-44 w-full rounded-lg object-cover"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
          />
        )}

        {/* 오늘 개관 상태 + 휴관일 원문(항상 함께) */}
        <div className={cn('rounded-lg border px-3 py-2.5', openStateBadgeClass(museum.openToday))}>
          <div className="flex items-center gap-1.5 text-sm font-semibold">
            <Clock className="size-4" />
            {openStateLabel(museum.openToday)}
          </div>
          {museum.restRaw ? (
            <p className="mt-1 text-xs leading-relaxed opacity-90">
              휴관일 원문: <span className="font-medium">{museum.restRaw}</span>
            </p>
          ) : (
            <p className="mt-1 text-xs opacity-90">휴관일 정보가 제공되지 않았습니다.</p>
          )}
          {museum.openToday === 'unknown' && (
            <p className="mt-1 text-[11px] opacity-75">
              휴관 규칙을 자동으로 해석하지 못했습니다. 원문을 직접 확인하세요.
            </p>
          )}
          <p className="mt-1 text-[11px] opacity-70">
            ※ 공휴일 휴관은 자동 반영되지 않습니다(공휴일 판정 미지원).
          </p>
        </div>

        {/* 관람시간 */}
        {museum.hours && (
          <Row icon={<Clock className="size-4" />} label="관람시간">
            <span className="whitespace-pre-line">{museum.hours}</span>
          </Row>
        )}
        {/* 입장료 */}
        {museum.fee && (
          <Row icon={<CircleDollarSign className="size-4" />} label="입장료">
            <span className="whitespace-pre-line">{museum.fee}</span>
          </Row>
        )}
        {/* 주차 */}
        {museum.parking && (
          <Row icon={<ParkingCircle className="size-4" />} label="주차">
            <span className="whitespace-pre-line">{museum.parking}</span>
          </Row>
        )}
        {/* 전화 */}
        {museum.tel && (
          <Row icon={<Phone className="size-4" />} label="전화">
            <a href={`tel:${museum.tel}`} className="text-primary hover:underline">
              {museum.tel}
            </a>
          </Row>
        )}

        {/* 길찾기 */}
        <div className="flex flex-wrap gap-2 pt-1">
          <a
            href={`https://map.kakao.com/link/to/${encodeURIComponent(museum.title)},${museum.lat},${museum.lon}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <MapPin className="size-3" />
            길찾기
          </a>
          <a
            href={`https://search.naver.com/search.naver?query=${encodeURIComponent(museum.title)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
          >
            <Info className="size-3" />
            검색
          </a>
        </div>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
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
