// 과부하(stress) 테스트: MAX_VUS까지 계속 밀어붙여서 어디서 무너지는지(병목)를
// 관찰한다. load.js와 달리 목표는 SLA 유지가 아니라 붕괴 지점을 찾는 것이라
// thresholds를 느슨하게 잡는다. 이 값들도 load.js와 마찬가지로 로컬 dev 환경
// (옵저버빌리티 스택 포함 12개 컨테이너가 한 머신에서 같이 도는 docker compose)
// 실측 기준이다. 짧은 실행(MAX_VUS=10, 30초)에서도 stats_heavy 계열의 raw
// aggregation 쿼리가 DB 커넥션을 오래 붙잡아 core/heavy가 도미노로 느려지는 게
// 관찰됐고, 애초에 "즉시 실패로 뜨면 신호 가치가 떨어진다"는 목적에 맞춰
// 원래보다 더 느슨하게 잡았다.
//
// 엔드포인트 풀은 load.js와 같은 카탈로그를 쓰되, heavy 티어(postings_map,
// postings_search)의 가중치를 3배로 올린 별도 풀을 구성한다. 과부하 테스트는
// 일부러 무거운 경로를 더 자주 때려서 병목을 찾는 게 목적이기 때문이다.
// external(news_*)은 완전히 제외한다.
//
// 이 테스트는 서버에 실제로 부담을 주므로 프로덕션에서는 기본적으로 실행이
// 막혀 있다(guardAgainstProd). 로컬 전용으로 설계했다.
//
// 실행(이 k6/ 폴더 안에서): k6 run -e BASE_URL=http://localhost:8000 stress.js
import { sleep, group } from "k6";
import { taggedGet, pickWeighted, poolExcluding } from "./lib/request.js";
import { fetchDynamicFixtures } from "./lib/setupData.js";
import { guardAgainstProd } from "./lib/guard.js";
import { buildHandleSummary } from "./lib/summary.js";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
guardAgainstProd(BASE_URL);

const MAX_VUS = Number(__ENV.MAX_VUS || 60);
const RAMP_DURATION = __ENV.RAMP_DURATION || "30s";
const PLATEAU_DURATION = __ENV.PLATEAU_DURATION || "2m";
const COOLDOWN_DURATION = __ENV.COOLDOWN_DURATION || "20s";

const BASE_POOL = poolExcluding(["external"]);
const HEAVY_WEIGHT_MULTIPLIER = 3;
// heavy 티어만 가중치를 올린 사본. build/category/name/metric 참조는 원본 그대로
// 공유하고 weight만 바꾼다.
const STRESS_POOL = BASE_POOL.map((ep) => ({
  ...ep,
  weight: ep.tier === "heavy" ? ep.weight * HEAVY_WEIGHT_MULTIPLIER : ep.weight,
}));

export const options = {
  stages: [
    { duration: RAMP_DURATION, target: MAX_VUS },
    { duration: PLATEAU_DURATION, target: MAX_VUS },
    { duration: COOLDOWN_DURATION, target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"], // 관찰 목적이라 느슨하게
    "http_req_duration{tier:core}": ["p(95)<3500"],
    "http_req_duration{tier:heavy}": ["p(95)<5000"],
  },
};

export function setup() {
  return fetchDynamicFixtures(BASE_URL);
}

export default function (fixtures) {
  const ep = pickWeighted(STRESS_POOL);
  group(ep.category, () => {
    taggedGet(ep.name, `${BASE_URL}${ep.build(fixtures)}`);
  });
  sleep(Math.random() * 0.5 + 0.2); // load.js보다 짧게: VU 수로 부하를 만드는 게 목적
}

export const handleSummary = buildHandleSummary("stress");
