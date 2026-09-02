'use client';

import { Command } from 'cmdk';
import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Clock,
  FlaskConical,
  Image as ImageIcon,
  Landmark,
  MapPin,
  Palette,
  Search,
} from 'lucide-react';

import { KIND_OPTIONS, SIDO_OPTIONS, type Filters } from '@/lib/facets';
import { KIND_LABEL, type MuseumKind } from '@/lib/museums';
import type { MuseumIndexItem } from '@/lib/types';

/**
 * 커맨드 팔레트(⌘K / Ctrl+K). shadcn 이 쓰는 `cmdk` 를 그대로 쓴다(검색 필터·키보드 내비·ARIA
 * 는 cmdk 가 담당). 감싸는 모달 오버레이만 직접 그린다.
 *
 * 두 가지를 한다:
 *  1) 박물관 이름 검색(전국 ≈629곳). **클라이언트에서** 인덱스로만(키 입력마다 서버 안 때림).
 *  2) 필터 토글(오늘 여는 곳·종류·지역). 부모의 filters 상태를 그대로 바꾼다(팔레트/사이드바가
 *     같은 상태 공유 — 두 벌로 갈라지지 않게).
 */

const MAX_RESULTS = 40;

const KIND_ICON: Record<MuseumKind, React.ReactNode> = {
  museum: <Landmark className="size-4" />,
  gallery: <Palette className="size-4" />,
  exhibition: <ImageIcon className="size-4" />,
  memorial: <Building2 className="size-4" />,
  science: <FlaskConical className="size-4" />,
};

export function CommandPalette({
  open,
  onClose,
  index,
  indexLoading,
  filters,
  onToggleKind,
  onToggleOpenToday,
  onToggleSido,
  onSelectMuseum,
}: {
  open: boolean;
  onClose: () => void;
  index: MuseumIndexItem[] | null;
  indexLoading: boolean;
  filters: Filters;
  onToggleKind: (k: MuseumKind) => void;
  onToggleOpenToday: () => void;
  /** 시도 토글은 지도 이동·영역 해제 부수효과가 있어 부모 핸들러를 공유한다(상태 갈라짐 방지). */
  onToggleSido: (key: string) => void;
  onSelectMuseum: (id: string) => void;
}) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!index || !q) return [];
    const hits: MuseumIndexItem[] = [];
    for (const m of index) {
      if (m.title.toLowerCase().includes(q)) {
        hits.push(m);
        if (hits.length >= MAX_RESULTS) break;
      }
    }
    return hits;
  }, [index, q]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-popover shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <Command
          shouldFilter={false}
          label="박물관 검색 및 필터"
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              if (query) setQuery('');
              else onClose();
            }
          }}
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="size-4 shrink-0 text-muted-foreground" />
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="박물관·미술관 이름 검색, 또는 필터 선택…"
              className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <Command.List className="max-h-[60vh] overflow-y-auto p-1.5">
            {indexLoading && !index && (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
                전국 박물관 목록 불러오는 중…
              </div>
            )}

            {q && (
              <Command.Empty className="py-6 text-center text-xs text-muted-foreground">
                “{query}”에 맞는 박물관이 없습니다
              </Command.Empty>
            )}

            {/* 필터 토글: 검색어 없을 때만 노출 */}
            {!q && (
              <Command.Group
                heading="필터"
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                <Item
                  active={filters.openTodayOnly}
                  icon={<Clock className="size-4" />}
                  onSelect={onToggleOpenToday}
                >
                  오늘 여는 곳만
                </Item>
                {KIND_OPTIONS.map((o) => (
                  <Item
                    key={`k-${o.key}`}
                    active={filters.kinds.includes(o.key)}
                    icon={KIND_ICON[o.key]}
                    onSelect={() => onToggleKind(o.key)}
                  >
                    종류 · {o.label}
                  </Item>
                ))}
                {SIDO_OPTIONS.map((o) => (
                  <Item
                    key={`s-${o.key}`}
                    active={filters.sido === o.key}
                    icon={<MapPin className="size-4" />}
                    onSelect={() => onToggleSido(o.key)}
                  >
                    지역 · {o.label}
                  </Item>
                ))}
              </Command.Group>
            )}

            {/* 이름 검색 결과 */}
            {q && results.length > 0 && (
              <Command.Group
                heading={`박물관 ${results.length}곳${results.length >= MAX_RESULTS ? '+' : ''}`}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
              >
                {results.map((m) => (
                  <Item
                    key={m.id}
                    value={`${m.id}-${m.title}`}
                    icon={KIND_ICON[m.kind]}
                    onSelect={() => onSelectMuseum(m.id)}
                  >
                    <span className="flex min-w-0 flex-1 items-baseline justify-between gap-2">
                      <span className="truncate">{m.title}</span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {KIND_LABEL[m.kind]}
                      </span>
                    </span>
                  </Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}

function Item({
  active,
  icon,
  onSelect,
  value,
  children,
}: {
  active?: boolean;
  icon: React.ReactNode;
  onSelect: () => void;
  value?: string;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {active && <span className="shrink-0 text-[11px] font-medium text-primary">적용됨</span>}
    </Command.Item>
  );
}
