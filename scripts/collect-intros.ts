/**
 * detailIntro2(휴관일·관람시간·요금·주차) 오프라인 전량 수집 → `data/intros.json`(리포 커밋용 정적본).
 *
 * 왜: detailIntro2 는 일일 쿼터 1,000/op + 초당 토큰버킷 throttle 이라 런타임 회전으로는 하루에
 * 전량(≈1,680)을 못 받고, 서버리스 인스턴스 메모리라 인스턴스가 바뀌면 0% 로 돌아간다. 준정적
 * 데이터이니 여기서 모아 리포에 넣고 런타임은 그걸 기본으로 쓴다(lib/intro-static.ts).
 *
 * 사용:  npm run collect:intros [-- --force] [--max N] [--out data/intros.json]
 *  - 기본: 스냅샷에 없는 id 만 수집(재개 가능 — 며칠에 나눠 돌려도 이어진다).
 *  - --force: 전량을 가장 오래 받은 것부터 갱신(하루 상한 안에서 매번 다른 것을 갱신).
 *  - --max N: 이 실행의 detailIntro2 요청 상한(기본 800 — 런타임 회전 ≤150 과 같은 일일 쿼터를 나눠 쓴다. 절대 1,000 초과 금지).
 *  - 일일 쿼터(code 22)를 만나면 **즉시 저장하고 중단**(다음 실행이 이어감). 요청당 실패는 기록 후 계속.
 *  - 진행 로그는 stderr. 키 값은 절대 출력하지 않는다.
 *
 * 종료 코드: 0=정상(부분 수집 포함), 2=키 없음/목록 실패.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { fetchIntrosBatch, fetchMuseumList, MuseumApiFailure } from '../lib/museum-api';
import {
  EMPTY_SNAPSHOT,
  parseSnapshot,
  pickIntroFields,
  planCollection,
  withResults,
  type IntroSnapshot,
} from '../lib/intro-static';
import type { MuseumIntroRaw } from '../lib/museums';

const DEFAULT_OUT = 'data/intros.json';
/** 이 실행의 요청 상한 기본값. 쿼터 1,000/일에 areaBasedList2·앱 회전 마진을 남긴다. */
const DEFAULT_MAX = 800;
const HARD_MAX = 1000;
/** fetchIntrosBatch 한 번에 넘길 id 수. 배치 내부 시간예산(55s)에 확실히 들어오고, 실패분 집계가 쉽다. */
const CHUNK = 100;
/** 청크가 끝날 때마다 저장 — 중간에 죽어도 그때까지의 결과는 남는다. */
const SAVE_EVERY_CHUNK = true;

const log = (msg: string) => process.stderr.write(`[collect-intros] ${msg}\n`);

/** .env.local 의 KEY=VALUE 를 process.env 에 넣는다(이미 있으면 유지). 값은 절대 로그에 안 남긴다. */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, rawV] = m;
    const v = rawV.replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

interface Args {
  force: boolean;
  max: number;
  out: string;
}

function parseArgs(argv: string[]): Args {
  let force = false;
  let max = DEFAULT_MAX;
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--force') force = true;
    else if (a === '--max') max = Number(argv[++i]);
    else if (a.startsWith('--max=')) max = Number(a.slice(6));
    else if (a === '--out') out = argv[++i];
    else if (a.startsWith('--out=')) out = a.slice(6);
    else throw new Error(`알 수 없는 인자: ${a}`);
  }
  if (!Number.isInteger(max) || max <= 0 || max > HARD_MAX) {
    throw new Error(`--max 는 1..${HARD_MAX} 정수여야 합니다 (받음: ${max})`);
  }
  return { force, max, out };
}

function readSnapshot(file: string): IntroSnapshot {
  if (!existsSync(file)) return EMPTY_SNAPSHOT;
  try {
    return parseSnapshot(JSON.parse(readFileSync(file, 'utf8')));
  } catch (e) {
    log(`기존 스냅샷 해석 실패(${(e as Error).message}) — 빈 스냅샷에서 시작`);
    return EMPTY_SNAPSHOT;
  }
}

/** 키 순서를 고정해(id 정렬) 커밋 diff 가 안정적이게 저장한다. */
function writeSnapshot(file: string, snap: IntroSnapshot): void {
  const sortKeys = <T>(o: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
  const stable: IntroSnapshot = {
    collectedAt: snap.collectedAt,
    byId: sortKeys(snap.byId),
    fetchedAt: sortKeys(snap.fetchedAt),
  };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(stable, null, 1)}\n`);
}

const ymdKst = (d = new Date()) => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);

async function main(): Promise<number> {
  loadDotEnv(resolve(process.cwd(), '.env.local'));
  const args = parseArgs(process.argv.slice(2));
  const outFile = resolve(process.cwd(), args.out);

  if (!process.env.DATA_GO_KR_KEY?.trim() && !process.env.HORSE?.trim()) {
    log('DATA_GO_KR_KEY 가 없습니다(.env.local 또는 환경변수). 중단.');
    return 2;
  }

  let snap = readSnapshot(outFile);
  log(`기존 스냅샷: ${Object.keys(snap.byId).length}건 (collectedAt=${snap.collectedAt || '없음'})`);

  let ids: string[];
  try {
    const list = await fetchMuseumList();
    ids = list.map((r) => r.contentid?.trim()).filter((x): x is string => !!x);
  } catch (e) {
    const code = e instanceof MuseumApiFailure ? e.code : 'ERR';
    log(`목록(areaBasedList2) 실패 [${code}]: ${(e as Error).message}`);
    return 2;
  }
  const total = ids.length;
  const plan = planCollection(ids, snap, args.force);
  const targets = plan.slice(0, args.max);
  log(
    `카탈로그 ${total}건 · 대상 ${plan.length}건(force=${args.force}) · 이번 실행 상한 ${args.max} → ${targets.length}건 요청 예정`,
  );

  let attempted = 0;
  let ok = 0;
  let failed: string[] = [];
  let quotaHit = false;
  const started = Date.now();
  const today = ymdKst();

  for (let i = 0; i < targets.length && !quotaHit; i += CHUNK) {
    const chunk = targets.slice(i, i + CHUNK);
    const batch = await fetchIntrosBatch(chunk);
    attempted += batch.attempted;
    quotaHit = batch.quotaHit;

    const results = new Map<string, MuseumIntroRaw | null>();
    for (const [id, raw] of batch.results) {
      results.set(id, pickIntroFields(raw as Record<string, unknown> | null));
    }
    ok += results.size;
    // 시작했는데 결과가 없는 id = 실패(재시도 없음, 다음 실행 대상). 쿼터로 시작 못 한 것은 실패가 아니다.
    const startedIds = chunk.slice(0, batch.attempted);
    failed = [...failed, ...startedIds.filter((id) => !results.has(id))];

    snap = withResults(snap, results, today, new Date().toISOString());
    if (SAVE_EVERY_CHUNK) writeSnapshot(outFile, snap);

    const elapsed = ((Date.now() - started) / 1000).toFixed(0);
    log(
      `진행 ${Math.min(i + CHUNK, targets.length)}/${targets.length} · 요청 ${attempted} · 성공 ${ok} · 실패 ${failed.length} · ${elapsed}s${quotaHit ? ' · ★ 일일 쿼터(code 22) — 저장 후 중단' : ''}`,
    );
  }

  writeSnapshot(outFile, snap);
  const covered = ids.filter((id) => Object.prototype.hasOwnProperty.call(snap.byId, id)).length;
  log(
    `완료: 요청 ${attempted} · 성공 ${ok} · 실패 ${failed.length}${failed.length ? ` (${failed.slice(0, 10).join(',')}${failed.length > 10 ? ',…' : ''})` : ''} · 쿼터소진=${quotaHit}`,
  );
  log(`커버리지: ${covered}/${total} (${((covered / Math.max(1, total)) * 100).toFixed(1)}%) → ${args.out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    log(`치명적 오류: ${(e as Error).message}`);
    process.exit(2);
  },
);
