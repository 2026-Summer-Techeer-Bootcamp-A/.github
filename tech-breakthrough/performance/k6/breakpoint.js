// 중단점(breakpoint) 테스트: START_VUS에서 시작해 STEP_VUS씩 계속 계단을 올리며
// MAX_VUS까지 밀어붙인다. stress.js와 달리 냉각(cooldown) 구간이 없다 — 목적이
// "얼마나 견디다 무너지는가"이지 "무너진 뒤 회복하는가"가 아니기 때문이다.
//
// 계단마다 STEP_RAMP(짧은 램프)로 다음 VU 수까지 올라간 뒤 STEP_DURATION만큼 그
// 수준을 평평하게 유지한다. 이 평평한 구간이 있어야 threshold의 delayAbortEval이
// "안정된 상태에서 에러율이 기준을 넘었다"를 제대로 평가할 수 있다.
//
// 핵심은 thresholds의 abortOnFail이다. 이제 두 조건 중 하나만 걸려도 멈춘다.
//   1) http_req_failed rate가 ERROR_THRESHOLD를 넘고(그 상태가 delayAbortEval인
//      15초만큼 유지되면) 멈춘다.
//   2) http_req_duration의 p95가 LATENCY_ABORT_MS를 넘고(그 상태가 delayAbortEval인
//      20초만큼 유지되면) 멈춘다.
// 조건 2)를 추가한 이유는 실측 때문이다. 로컬 dev DB는 에러를 뱉지 않고 그냥
// 계속 느려지기만 하는 특성이 있어서(무거운 raw aggregation 쿼리가 커넥션을
// 오래 붙잡을 뿐 500을 반환하지는 않는다), 에러율 기준만으로는 중단점을 영영
// 못 찾고 MAX_VUS까지 그냥 다 돌아버릴 위험이 컸다. 지연 기준을 같이 걸어서
// "에러 없이 무한정 느려지기만 하는" 붕괴 양상도 잡아낸다.
// 이 테스트는 threshold abort로 스스로 멈춘다. 멈춘 시점의 경과 시간을 Grafana
// 대시보드의 VU/시간 축과 대조하면 대략 몇 VU에서 깨졌는지 알 수 있다. MAX_VUS까지
// 도달하고도 안 멈췄다면 이 서버의 한계를 이 테스트 범위 안에서 못 찾은 것이니
// MAX_VUS/STEP_VUS를 올려서 재실행하라.
//
// 엔드포인트 풀은 load.js와 같은 기본 가중치(external 제외)를 그대로 쓴다.
// stress.js처럼 heavy를 인위적으로 올리지 않는다 — 현실적인 트래픽 구성에서
// 어디가 먼저 깨지는지 보는 게 목적이다.
//
// 이 테스트는 서버에 실제로 부담을 주므로 프로덕션에서는 기본적으로 실행이
// 막혀 있다(guardAgainstProd). 로컬 전용으로 설계했다.
//
// 실행(이 k6/ 폴더 안에서): k6 run -e BASE_URL=http://localhost:8000 breakpoint.js
import { sleep, group } from "k6";
import { taggedGet, pickWeighted, poolExcluding } from "./lib/request.js";
import { fetchDynamicFixtures } from "./lib/setupData.js";
import { guardAgainstProd } from "./lib/guard.js";
import { buildHandleSummary } from "./lib/summary.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
guardAgainstProd(BASE_URL);

const START_VUS = Number(__ENV.START_VUS || 10);
const STEP_VUS = Number(__ENV.STEP_VUS || 10);
const STEP_DURATION = __ENV.STEP_DURATION || "30s";
const MAX_VUS = Number(__ENV.MAX_VUS || 200);
const ERROR_THRESHOLD = Number(__ENV.ERROR_THRESHOLD || 0.05);
const LATENCY_ABORT_MS = Number(__ENV.LATENCY_ABORT_MS || 8000);

// 계단 사이 램프 구간. STEP_DURATION 전체를 램프에 쓰면 평평한 유지 구간이 없어져서
// delayAbortEval이 평가할 "안정 상태"가 사라지므로, 짧게 고정해서 나머지를 유지
// 구간으로 남긴다.
const STEP_RAMP = "5s";

function buildStairStages() {
  const stages = [];
  let target = START_VUS;
  stages.push({ duration: STEP_RAMP, target });
  stages.push({ duration: STEP_DURATION, target });
  while (target < MAX_VUS) {
    target = Math.min(target + STEP_VUS, MAX_VUS);
    stages.push({ duration: STEP_RAMP, target });
    stages.push({ duration: STEP_DURATION, target });
  }
  return stages;
}

const POOL = poolExcluding(["external"]);

export const options = {
  stages: buildStairStages(),
  thresholds: {
    http_req_failed: [
      { threshold: `rate<${ERROR_THRESHOLD}`, abortOnFail: true, delayAbortEval: "15s" },
    ],
    // 에러율이 안 오르고 그냥 계속 느려지기만 하는 붕괴 양상도 잡기 위한 지연
    // 기준 abort. 둘 중 하나만 걸려도 멈춘다.
    http_req_duration: [
      { threshold: `p(95)<${LATENCY_ABORT_MS}`, abortOnFail: true, delayAbortEval: "20s" },
    ],
  },
};

export function setup() {
  return fetchDynamicFixtures(BASE_URL);
}

export default function (fixtures) {
  const ep = pickWeighted(POOL);
  group(ep.category, () => {
    taggedGet(ep.name, `${BASE_URL}${ep.build(fixtures)}`);
  });
  sleep(Math.random() * 1.5 + 0.5);
}

export const handleSummary = buildHandleSummary("breakpoint");
