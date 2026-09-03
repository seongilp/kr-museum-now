import Link from 'next/link';
import { Clock, Image as ImageIcon, Landmark, MapPin, Navigation, Palette, Search } from 'lucide-react';

import { buttonVariants } from '@/components/ui/button';

/**
 * 랜딩 페이지(서버 컴포넌트). 니치를 한 문장으로 세우고 지도로 보낸다.
 * SEO 를 위해 실제 설명 텍스트를 서버에서 렌더한다 — 지도 앱 본체는 클라이언트라 크롤러가
 * 못 읽으므로, 이 페이지가 색인의 근거가 된다.
 */
export default function Landing() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-5 py-10">
      <div className="flex flex-1 flex-col justify-center">
        <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground">
          <Landmark className="size-3.5 text-primary" />
          한국관광공사 공식 데이터 · 전국 박물관·미술관·전시관·기념관·과학관 1,600여 곳
        </div>

        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
          내 주변 박물관·미술관,
          <br />
          오늘 여는 곳만 골라 지도에서.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-muted-foreground">
          월요일 휴관으로 헛걸음한 적 있나요? &ldquo;오늘 여는 곳&rdquo;만 걸러 지도에서 바로 확인하세요.
          관람시간·입장료·주차·휴관일까지 한눈에.
        </p>

        <div className="mt-8">
          <Link
            href="/map"
            className={buttonVariants({
              size: 'lg',
              className: 'h-12 w-full gap-2 text-base sm:w-auto sm:px-8',
            })}
          >
            <Navigation className="size-4" />
            지도 열기
          </Link>
        </div>

        <ul className="mt-12 grid gap-4 text-sm sm:grid-cols-2">
          <Feature icon={<Clock className="size-5 text-green-400" />}>
            <b className="text-foreground">오늘 여는 곳</b> 필터 — 휴관일을 해석해 오늘 휴관이 확실한 곳을
            뺍니다. 휴관 정보는 일부만 반영되니 방문 전 확인하세요.
          </Feature>
          <Feature icon={<MapPin className="size-5 text-primary" />}>
            현재 위치 기준 가까운 곳부터. 위치를 못 잡으면 서울 기준으로 보여줍니다.
          </Feature>
          <Feature icon={<Palette className="size-5 text-primary" />}>
            종류 필터: 박물관 · 미술관 · 전시관 · 기념관 · 과학관.
          </Feature>
          <Feature icon={<ImageIcon className="size-5 text-purple-400" />}>
            <b className="text-foreground">지금 하는 전시</b> — 오늘·이번 주말·이번 달 열리는 전시를 지도에
            함께. 문화정보 공연전시 데이터.
          </Feature>
          <Feature icon={<Search className="size-5 text-primary" />}>
            ⌘K 로 이름 검색과 필터를 한곳에서. 지도를 옮기면 그 지역이 나옵니다.
          </Feature>
        </ul>

        {/* 한계를 첫 화면부터 정직하게 */}
        <p className="mt-8 rounded-lg border border-border bg-card/50 p-3 text-xs leading-relaxed text-muted-foreground">
          휴관일은 각 기관이 등록한 원문을 해석합니다. <b>공휴일 휴관은 자동 반영되지 않습니다</b>
          (공휴일 판정 미지원). 방문 전 원문과 각 기관 공지를 함께 확인하세요. 전시 일정은 문화정보
          공연전시 데이터 기준이며, 좌표가 없는 일부 전시는 목록으로만 보여줍니다.
        </p>
      </div>

      <footer className="mt-10 border-t border-border pt-4 text-xs text-muted-foreground">
        데이터 출처: 한국관광공사 KorService2(문화시설) · 좌표 WGS84
      </footer>
    </main>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}
