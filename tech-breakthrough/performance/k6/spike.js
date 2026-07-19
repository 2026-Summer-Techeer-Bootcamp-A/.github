// 스파이크(spike) 테스트: 평상시 수준(BASE_VUS)에서 순간적으로 VU를 크게
// 급증(SPIKE_VUS)시켰다가 다시 평상시로 급감시켜, 갑작스런 트래픽 폭증에 대한
// 대응력과 회복력을 관찰한다. stress.js처럼 특정 무거운 경로를 노리는 게 아니라
// 트래픽 형태(급증/급감) 자체가 관심사라, 엔드포인트 풀은 load.js와 같은 기본
// 가중치(external 제외)를 그대로 쓴다.
//
// 각 iteration마다 setup() 시점 이후 경과 시간을 기준으로 지금이 baseline(평상시
// 유지) / spike(급증 램프 + 유지) / recovery(급감 이후) 중 어느 phase인지 판정해서
// 요청에 phase 태그를 붙인다. 스파이크 중 일시적인 지연/실패는 정상적인 현상으로
// 보고 hard threshold를 걸지 않는다 — handleSummary가 만드는 JSON의 phase별
// 통계(태그로 구분된 원시 데이터)를 사후에 Grafana나 결과 JSON에서 비교해서
// "스파이크 중 얼마나 나빠졌고, recovery 구간에서 얼마나 빨리 되돌아왔는가"를
// 판단한다.
//
// thresholds에 phase별 항목(http_req_duration{phase:*}, http_req_failed{phase:*})이
// 있는데, 이건 진짜 SLA가 아니라 순전히 k6가 이 태그 조합의 서브 메트릭을
// end-of-test summary(data.metrics)에 노출하게 만드는 용도다. k6는 threshold에서
// 참조된 태그 조합만 summary 데이터로 materialize한다(문서화된 동작). threshold를
// 안 걸면 phase 태그 자체는 요청마다 붙어도 data.metrics에 phase별 서브 메트릭이
// 아예 안 생겨서, lib/summary.js가 phase별 표를 만들 재료가 없어진다. 그래서
// 절대 실패하지 않을 만큼 느슨한 값으로 걸어둔다.
//
// 이 테스트는 서버에 실제로 부담을 주므로 프로덕션에서는 기본적으로 실행이
// 막혀 있다(guardAgainstProd). 로컬 전용으로 설계했다.
//
// 실행(이 k6/ 폴더 안에서): k6 run -e BASE_URL=http://localhost:8000 spike.js
import { sleep, group } from "k6";
import { taggedGet, pickWeighted, poolExcluding } from "./lib/request.js";
import { fetchDynamicFixtures } from "./lib/setupData.js";
import { guardAgainstProd } from "./lib/guard.js";
import { buildHandleSummary } from "./lib/summary.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
guardAgainstProd(BASE_URL);

const BASE_VUS = Number(__ENV.BASE_VUS || 5);
const SPIKE_VUS = Number(__ENV.SPIKE_VUS || 100);
const SPIKE_RAMP = __ENV.SPIKE_RAMP || "10s";
const SPIKE_HOLD = __ENV.SPIKE_HOLD || "30s";
const RECOVERY_HOLD = __ENV.RECOVERY_HOLD || "30s";
const BASE_HOLD = __ENV.BASE_HOLD || "20s";

const POOL = poolExcluding(["external"]);

export const options = {
  stages: [
    { duration: BASE_HOLD, target: BASE_VUS }, // 평상시 수준으로 예열
    { duration: SPIKE_RAMP, target: SPIKE_VUS }, // 급증
    { duration: SPIKE_HOLD, target: SPIKE_VUS }, // 스파이크 유지
    { duration: "10s", target: BASE_VUS }, // 급감
    { duration: RECOVERY_HOLD, target: BASE_VUS }, // 회복 관찰
    { duration: "10s", target: 0 }, // 정리
  ],
  thresholds: {
    // 스파이크 중 일시적 degradation은 정상이라 느슨하게 잡는다.
    http_req_failed: ["rate<0.20"],
    // 아래 phase별 항목은 SLA가 아니라 summary 데이터 노출용(파일 상단 주석
    // 참고). 절대 실패하지 않을 값으로 걸어서 관찰용으로만 쓴다.
    "http_req_duration{phase:baseline}": ["p(95)<60000"],
    "http_req_duration{phase:spike}": ["p(95)<60000"],
    "http_req_duration{phase:recovery}": ["p(95)<60000"],
    "http_req_failed{phase:baseline}": ["rate<1"],
    "http_req_failed{phase:spike}": ["rate<1"],
    "http_req_failed{phase:recovery}": ["rate<1"],
  },
};

// "10s"/"1m30s" 같은 k6 duration 문자열을 밀리초로 변환한다(phase 판정용).
function parseDurationMs(str) {
  const match = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/.exec(String(str).trim());
  if (!match) {
    throw new Error(`지원하지 않는 duration 형식: ${str}`);
  }
  const value = Number(match[1]);
  const multipliers = { ms: 1, s: 1000, m: 60000, h: 3600000 };
  return value * multipliers[match[2]];
}

const BASELINE_END_MS = parseDurationMs(BASE_HOLD);
const SPIKE_END_MS = BASELINE_END_MS + parseDurationMs(SPIKE_RAMP) + parseDurationMs(SPIKE_HOLD);

// elapsed(ms) 기준으로 지금이 baseline/spike/recovery 중 어느 phase인지 판정한다.
// 급감 램프(10s)와 recovery hold, 마무리 램프(10s)는 전부 "recovery"로 묶는다.
function phaseAt(elapsedMs) {
  if (elapsedMs < BASELINE_END_MS) {
    return "baseline";
  }
  if (elapsedMs < SPIKE_END_MS) {
    return "spike";
  }
  return "recovery";
}

export function setup() {
  const fixtures = fetchDynamicFixtures(BASE_URL);
  // 단일 프로세스 로컬 실행 기준: 모든 VU가 같은 k6 프로세스 시계를 공유하므로
  // Date.now() - startTimeMs로 경과 시간을 구할 수 있다.
  return { ...fixtures, startTimeMs: Date.now() };
}

export default function (data) {
  const elapsed = Date.now() - data.startTimeMs;
  const phase = phaseAt(elapsed);

  const ep = pickWeighted(POOL);
  group(ep.category, () => {
    taggedGet(ep.name, `${BASE_URL}${ep.build(data)}`, {}, { phase });
  });

  sleep(Math.random() * 1.5 + 0.5);
}

export const handleSummary = buildHandleSummary("spike");
