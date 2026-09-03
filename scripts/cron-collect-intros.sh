#!/usr/bin/env bash
# 휴관일 상세(detailIntro2) 스냅샷 주간 갱신 — ebs 서버 크론용.
#
# GitHub Actions 대신 서버에서 돈다(사용자 결정 2026-09-03). 흐름:
#   git pull → npm ci(잠금파일 바뀐 경우만) → collect:intros → 변경 시 data/intros.json 커밋·푸시
#   → Vercel git 연동이 main 푸시를 받아 자동 배포한다.
#
# 스케줄(KST, 크론탭): 월·화 03:00 --force(전량, 실행당 ≤800 이라 이틀에 나눠 받는다),
# 수~일 03:00 은 빠진 id 만. 일일 쿼터(code 22)를 만나면 수집기가 그때까지 저장하고 0 으로 끝난다.
#
# 인수: --force 를 그대로 수집기에 넘긴다.
# 시크릿: $APP/.env.local 의 DATA_GO_KR_KEY (수집기가 직접 읽는다). 값은 절대 로그에 남기지 않는다.
set -euo pipefail

APP="${MUSEUM_APP_DIR:-$HOME/apps/kr-museum-now}"
LOG_DIR="$APP/logs"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/collect-$(date +%Y%m%d).log"
exec >>"$LOG" 2>&1

echo "== $(date '+%F %T') start args=[$*]"
cd "$APP"

# 겹침 방지. 전날 실행이 아직 돌면 조용히 건너뛰지 말고 로그에 남긴다(flock 침묵 스킵 함정).
exec 9>"$APP/.collect.lock"
if ! flock -n 9; then
  echo "이전 실행이 아직 진행 중 — 이번 회차 건너뜀"
  exit 0
fi

git fetch -q origin main
git reset -q --hard origin/main

if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  npm ci --no-audit --no-fund
fi

npm run collect:intros -- "$@"

node -e "const s=require('./data/intros.json'); if(!s||typeof s.byId!=='object') process.exit(1); console.log('byId:', Object.keys(s.byId).length, 'collectedAt:', s.collectedAt)"

# collectedAt 만 바뀐 건(쿼터 소진으로 0건 수집 등) 커밋하지 않는다 — 빈 커밋마다 Vercel 이 재배포된다.
if git diff --quiet -I '"collectedAt"' -- data/intros.json; then
  git checkout -q -- data/intros.json
  echo "실질 변경 없음 — 커밋 생략"
  exit 0
fi

COUNT=$(node -e "console.log(Object.keys(require('./data/intros.json').byId).length)")
git add data/intros.json
git -c user.name="ebs-collector" -c user.email="ebs-collector@users.noreply.github.com" \
  commit -q -m "chore(data): 휴관일 상세 스냅샷 갱신 (${COUNT}건)"
git push -q origin HEAD:main
echo "== $(date '+%F %T') pushed ${COUNT}건"
