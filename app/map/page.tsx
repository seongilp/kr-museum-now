import { MuseumsBrowser } from '@/components/museums-browser';

/**
 * 앱 본체. 지도가 첫 화면. 위치·필터는 클라이언트에서, 공간+필터+오늘개관 판정은 서버가 한다
 * (전량을 통째로 내리지 않고 조건에 맞는 가까운 곳만 골라 준다).
 */
export default function MapPage() {
  return <MuseumsBrowser />;
}
