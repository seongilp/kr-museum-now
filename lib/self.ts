/**
 * 자기 자신(공개 도메인)의 절대 URL. 서버 컴포넌트/라우트에서 자기 API 를 self-fetch 할 때 쓴다
 * (Next 의 서버측 fetch 는 절대 URL 이 필요하다).
 *
 * 왜 self-fetch 인가: 박물관 카탈로그는 ~629 detailIntro2 로 조립되는데, 이 조립 결과를 **하나의
 * Data Cache 엔트리**로 인스턴스 간 공유하려면 "조립 결과를 돌려주는 내부 라우트(/api/catalog)"를
 * `next:{revalidate}` 로 한 번 fetch 하면 된다. 그러면 그 단일 fetch 만 캐시돼(≈190KB) 콜드
 * 인스턴스도 상류를 다시 때리지 않는다. (개별 629 fetch 를 캐시 스코프에 넣으면 직렬화로 붕괴 —
 * museum-cache 주석 참조.)
 */
export function selfBaseUrl(): string {
  if (process.env.SELF_BASE_URL) return process.env.SELF_BASE_URL;
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? 'kr-museum-now.vercel.app';
  return `https://${host}`;
}
