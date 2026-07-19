// 부하 테스트: 읽기 전용 엔드포인트에 단계적으로 가상 유저(VU)를 늘려가며
// 처리량과 지연을 측정한다. LLM을 호출하는 /chat, /resume/parse 같은 엔드포인트와
// 쓰기(POST/PUT/DELETE) 엔드포인트는 대상에서 제외한다(비용 발생, 데이터 오염 위험).
//
// 로컬(docker-compose dev)에서 먼저 돌려 임계값을 확인하고, 프로덕션에는
// VU 수를 크게 낮춰 짧게만 돌린다. 프로덕션 DB는 1 vCPU/3.75GB로 작아서
// 과도한 부하가 다른 사용자와 데모에 영향을 줄 수 있다.
//
// 실행 예:
//   로컬:      k6 run -e BASE_URL=http://localhost:8000 loadtest/load.js
//   프로덕션:  k6 run -e BASE_URL=https://2026-techeer-a.duckdns.org \
//              -e MAX_VUS=5 -e DURATION=30s loadtest/load.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";
const MAX_VUS = Number(__ENV.MAX_VUS || 20);
const DURATION = __ENV.DURATION || "1m";

export const options = {
  stages: [
    { duration: "20s", target: Math.ceil(MAX_VUS * 0.25) }, // 서서히 예열
    { duration: DURATION, target: MAX_VUS }, // 목표 부하 유지
    { duration: "10s", target: 0 }, // 정리
  ],
  thresholds: {
    http_req_duration: ["p(95)<800"], // p95 지연 800ms 미만
    http_req_failed: ["rate<0.01"], // 에러율 1% 미만
  },
};

// 실제 트래픽처럼 여러 읽기 전용 엔드포인트를 섞어서 호출한다.
//
// /api/v1/postings는 `limit` 쿼리 파라미터를 받지 않는다(엔드포인트가 선언하지
// 않아 조용히 무시됨). pool 필터 없이 부르면 도메스틱+글로벌 전체(56.5만 건)를
// DB에서 다 가져온 뒤 파이썬에서 페이지를 자르는 구조라, 그 내부의 기술 스택
// 조회 쿼리가 Postgres의 파라미터 하드 리밋(65,535)을 넘겨 결정적으로 실패한다.
// pool=domestic으로 필터하면 47,065건으로 한도 아래라 안전하다. 근본 버그(DB
// 레벨 페이지네이션 부재)는 perf-build-journal/02-production-first-run.md에
// 기록했고 애플리케이션 코드 수정은 아직 하지 않았다.
const ENDPOINTS = [
  () => http.get(`${BASE_URL}/healthz`),
  () => http.get(`${BASE_URL}/api/v1/postings?pool=domestic`),
  () => http.get(`${BASE_URL}/skills`),
  () => http.get(`${BASE_URL}/api/v1/job-categories`),
];

export default function () {
  const call = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
  const res = call();
  check(res, { "status is 200": (r) => r.status === 200 });
  sleep(Math.random() * 1.5 + 0.5); // 사용자 사이 간격을 흉내
}
