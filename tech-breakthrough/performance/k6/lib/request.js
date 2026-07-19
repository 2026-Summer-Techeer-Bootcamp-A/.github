// 카탈로그 기반 GET 요청 헬퍼. http.get을 감싸서 태그, check(), 엔드포인트별 커스텀
// 메트릭 기록을 한 곳에서 처리한다.
import http from "k6/http";
import { check } from "k6";
import { ENDPOINTS, requestsTotal } from "./catalog.js";

function findEndpoint(name) {
  const ep = ENDPOINTS.find((e) => e.name === name);
  if (!ep) {
    throw new Error(`catalog.js에 없는 엔드포인트 이름: ${name}`);
  }
  return ep;
}

// name: catalog.js의 엔드포인트 이름. url: BASE_URL까지 조합된 완전한 URL.
// extraChecks: check()에 추가로 얹을 조건. extraTags: 요청 태그에 추가로 얹을 값
// (spike.js가 phase: "baseline"/"spike"/"recovery" 태깅에 사용한다).
export function taggedGet(name, url, extraChecks = {}, extraTags = {}) {
  const ep = findEndpoint(name);
  const res = http.get(url, {
    tags: { endpoint: name, tier: ep.tier, ...extraTags },
  });

  const passed = check(res, {
    [`${name} status 200`]: (r) => r.status === 200,
    ...extraChecks,
  });

  ep.durationMetric.add(res.timings.duration);
  ep.failedMetric.add(!passed);
  requestsTotal.add(1, { endpoint: name });

  return res;
}

// 누적합 기반 weighted random 선택. pool은 { weight } 필드를 가진 객체 배열이면
// 무엇이든 받는다(ENDPOINTS 원본이든, weight를 조정한 사본이든).
export function pickWeighted(pool) {
  const totalWeight = pool.reduce((sum, ep) => sum + ep.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const ep of pool) {
    roll -= ep.weight;
    if (roll <= 0) {
      return ep;
    }
  }
  // 부동소수점 오차로 roll이 끝까지 소진되지 않는 경우를 대비한 폴백.
  return pool[pool.length - 1];
}

// 특정 tier들을 제외한 카탈로그 서브셋을 돌려준다(예: external 제외).
export function poolExcluding(tiers) {
  return ENDPOINTS.filter((ep) => !tiers.includes(ep.tier));
}
