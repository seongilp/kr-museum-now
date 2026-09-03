import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OPEN_STATE_COLOR,
  openStateBadgeClass,
  openStateLabel,
  passesOpenTodayFilter,
  toDisplayState,
} from '../museum-ui';

describe('museum-ui — unknown → 추정 개관 표시 매핑', () => {
  it('toDisplayState: open/closed 는 그대로, unknown 은 assumed-open', () => {
    assert.equal(toDisplayState('open'), 'open');
    assert.equal(toDisplayState('closed'), 'closed');
    assert.equal(toDisplayState('unknown'), 'assumed-open');
  });

  it('핀 색: open·unknown 은 같은 초록, closed 만 빨강', () => {
    assert.equal(OPEN_STATE_COLOR.unknown, OPEN_STATE_COLOR.open);
    assert.notEqual(OPEN_STATE_COLOR.closed, OPEN_STATE_COLOR.open);
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
