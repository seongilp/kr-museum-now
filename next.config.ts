import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /*
   * 상위 디렉토리(~/)에 pnpm-workspace.yaml 이 있어서 Turbopack 이 루트를 그쪽으로 잡으려다
   * 경고를 뱉는다. 이 앱은 독립 프로젝트이므로 루트를 자기 자신으로 못 박는다.
   */
  turbopack: { root: import.meta.dirname },
  images: {
    // 관광공사(KorService2) 대표사진은 tong.visitkorea.or.kr 에서 온다. next/image 를 쓰지 않고
    // <img> 로 직접 그리므로(외부 CDN 최적화 불필요) 여기 등록은 방어적 표기만.
    remotePatterns: [{ protocol: 'https', hostname: 'tong.visitkorea.or.kr' }],
  },
};

export default nextConfig;
