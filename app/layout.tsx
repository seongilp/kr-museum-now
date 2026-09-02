import type { Metadata, Viewport } from 'next';
import { Noto_Sans_KR } from 'next/font/google';

import './globals.css';

/**
 * 루트 레이아웃. 국내 사용자용 한국어 앱이라 로케일 분기가 없다(`<html lang="ko">`).
 * 다크모드 기본(`class="dark"`)은 형제앱과 통일. 폰트는 한글 본문에 맞는 Noto Sans KR.
 */
const notoSansKr = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  display: 'swap',
});

const SITE = 'https://kr-museum-now.vercel.app';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: '코리아뮤지엄 — 내 주변 박물관·미술관, 오늘 여는 곳',
  description:
    '전국 박물관·미술관·전시관·기념관을 지도에서. 월요일 휴관으로 헛걸음하지 않게 "오늘 여는 곳"만 골라 보고, 관람시간·입장료·주차 정보까지 한눈에. 한국관광공사 공식 데이터.',
  keywords: [
    '박물관',
    '미술관',
    '전시관',
    '박물관 지도',
    '미술관 지도',
    '오늘 여는 박물관',
    '휴관일',
    '전시',
    '내 주변 박물관',
  ],
  alternates: { canonical: SITE },
  openGraph: {
    title: '코리아뮤지엄 — 내 주변 박물관·미술관, 오늘 여는 곳',
    description:
      '전국 박물관·미술관을 지도에서. "오늘 여는 곳"만 걸러 헛걸음 없이. 관람시간·입장료·휴관일까지.',
    url: SITE,
    siteName: '코리아뮤지엄',
    locale: 'ko_KR',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#0b0f19',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`dark ${notoSansKr.variable} antialiased`} suppressHydrationWarning>
      <body className="min-h-dvh bg-background text-foreground">{children}</body>
    </html>
  );
}
