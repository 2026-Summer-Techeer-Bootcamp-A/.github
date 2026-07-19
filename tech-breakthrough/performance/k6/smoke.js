// 스모크 테스트: 1 VU, 짧은 반복으로 엔드포인트가 정상 응답하는지만 확인한다.
// 부하테스트 전에 항상 먼저 돌려서 스크립트 자체와 대상 서버의 기본 동작을 검증한다.
//
// 실행: k6 run -e BASE_URL=http://localhost:8000 loadtest/smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    http_req_failed: ["rate==0"],
  },
};

const BASE_URL = __ENV.BASE_URL || "http://localhost:8000";

export default function () {
  const healthz = http.get(`${BASE_URL}/healthz`);
  check(healthz, { "healthz 200": (r) => r.status === 200 });

  const postings = http.get(`${BASE_URL}/api/v1/postings?limit=10`);
  check(postings, { "postings 200": (r) => r.status === 200 });

  const skills = http.get(`${BASE_URL}/skills`);
  check(skills, { "skills 200": (r) => r.status === 200 });

  sleep(1);
}
