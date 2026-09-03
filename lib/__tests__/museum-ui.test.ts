import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CLOSED_PIN_OPACITY,
  CLOSED_RING_COLOR,
  KIND_COLOR,
  OPEN_PIN_OPACITY,
  kindColorFor,
  openStateBadgeClass,
  openStateLabel,
  passesOpenTodayFilter,
  pinOpacityFor,
  toDisplayState,
} from '../museum-ui';

describe('museum-ui — unknown → 추정 개관 표시 매핑', () => {
  it('toDisplayState: open/closed 는 그대로, unknown 은 assumed-open', () => {
    assert.equal(toDisplayState('open'), 'open');
    assert.equal(toDisplayState('closed'), 'closed');
    assert.equal(toDisplayState('unknown'), 'assumed-open');
  });

  it('핀 투명도: closed 만 흐리게(0.35~0.45), open·unknown 은 같은 값', () => {
    assert.equal(pinOpacityFor('open'), OPEN_PIN_OPACITY);
    assert.equal(pinOpacityFor('unknown'), OPEN_PIN_OPACITY);
    assert.equal(pinOpacityFor('closed'), CLOSED_PIN_OPACITY);
    assert.ok(CLOSED_PIN_OPACITY >= 0.35 && CLOSED_PIN_OPACITY <= 0.45);
    assert.ok(OPEN_PIN_OPACITY > CLOSED_PIN_OPACITY);
  });

  it('배지 클래스: unknown 은 초록 계열, closed 는 빨강 계열', () => {
    assert.equal(openStateBadgeClass('unknown'), openStateBadgeClass('open'));
    assert.match(openStateBadgeClass('unknown'), /green/);
    assert.match(openStateBadgeClass('closed'), /red/);
  });

  it('라벨: 확정 개관은 추정 표기 없음, unknown 은 "방문 전 확인" 포함, closed 는 휴관', () => {
    assert.equal(openStateLabel('open'), '오늘 개관');
    assert.match(openStateLabel('unknown'), /오늘 개관/);
    assert.match(openStateLabel('unknown'), /방문 전 확인/);
    assert.equal(openStateLabel('closed'), '오늘 휴관');
  });

  it('오늘 여는 곳 필터: closed 만 제외, unknown 은 포함', () => {
    assert.equal(passesOpenTodayFilter('open'), true);
    assert.equal(passesOpenTodayFilter('unknown'), true);
    assert.equal(passesOpenTodayFilter('closed'), false);
  });
});

describe('museum-ui — 종류별 색(KIND_COLOR / kindColorFor)', () => {
  const HEX = /^#[0-9a-f]{6}$/i;

  it('6종 전부 유효한 hex 이고 서로 다르다', () => {
    const values = Object.values(KIND_COLOR);
    assert.equal(values.length, 6);
    for (const v of values) assert.match(v, HEX);
    assert.equal(new Set(values).size, values.length);
  });

  it('kindColorFor: 각 종류는 KIND_COLOR 와 일치', () => {
    assert.equal(kindColorFor('museum'), KIND_COLOR.museum);
    assert.equal(kindColorFor('gallery'), KIND_COLOR.gallery);
    assert.equal(kindColorFor('exhibition'), KIND_COLOR.exhibition);
    assert.equal(kindColorFor('memorial'), KIND_COLOR.memorial);
    assert.equal(kindColorFor('science'), KIND_COLOR.science);
    assert.equal(kindColorFor('other'), KIND_COLOR.other);
  });

  it('kindColorFor: 알 수 없는 값·null·undefined 는 기타(슬레이트)로 fallback', () => {
    assert.equal(kindColorFor('theater'), KIND_COLOR.other);
    assert.equal(kindColorFor(''), KIND_COLOR.other);
    assert.equal(kindColorFor(null), KIND_COLOR.other);
    assert.equal(kindColorFor(undefined), KIND_COLOR.other);
  });

  it('휴관 링 빨강은 어느 종류색과도 겹치지 않고, 종류색엔 파랑(내 위치)이 없다', () => {
    assert.match(CLOSED_RING_COLOR, HEX);
    assert.ok(!Object.values(KIND_COLOR).includes(CLOSED_RING_COLOR));
    assert.ok(!Object.values(KIND_COLOR).includes('#3b82f6'));
  });
});
