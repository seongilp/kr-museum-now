import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { haversineKm, nearest, SEOUL, type Located } from '../geo';

describe('haversineKm — 대권 거리', () => {
  it('같은 점은 0', () => {
    assert.equal(haversineKm(SEOUL, SEOUL), 0);
  });
  it('서울↔부산 ≈ 325km (±15)', () => {
    const busan = { lat: 35.1796, lon: 129.0756 };
    const km = haversineKm(SEOUL, busan);
    assert.ok(km > 310 && km < 340, `expected ~325, got ${km}`);
  });
});

describe('nearest — 서버 공간 필터의 심장', () => {
  const items: (Located & { id: string })[] = [
    { id: 'seoul', lat: SEOUL.lat, lon: SEOUL.lon },
    { id: 'near', lat: 37.57, lon: 126.98 },
    { id: 'incheon', lat: 37.4563, lon: 126.7052 },
    { id: 'busan', lat: 35.1796, lon: 129.0756 },
  ];

  it('가까운 순으로 정렬하고 거리를 붙인다', () => {
    const r = nearest(items, SEOUL, 10);
    assert.deepEqual(
      r.map((x) => x.item.id),
      ['seoul', 'near', 'incheon', 'busan'],
    );
    assert.equal(r[0].distanceKm, 0);
    assert.ok(r[1].distanceKm < r[2].distanceKm);
  });

  it('limit 로 개수를 자른다(클라이언트로 다 안 내린다)', () => {
    const r = nearest(items, SEOUL, 2);
    assert.equal(r.length, 2);
    assert.deepEqual(
      r.map((x) => x.item.id),
      ['seoul', 'near'],
    );
  });

  it('maxKm 반경 밖은 버린다', () => {
    const r = nearest(items, SEOUL, 10, 50); // 50km 반경 → 부산 제외
    assert.equal(
      r.some((x) => x.item.id === 'busan'),
      false,
    );
  });

  it('빈 입력이면 빈 결과', () => {
    assert.deepEqual(nearest([], SEOUL, 10), []);
  });
});
