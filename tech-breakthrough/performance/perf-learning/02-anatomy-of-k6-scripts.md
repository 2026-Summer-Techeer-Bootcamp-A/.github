# 우리 k6 스크립트 해부: smoke.js와 load.js는 실제로 어떻게 진행되는가

## 개요

01 문서에서 가상 사용자와 임계값 같은 개념을 다뤘다. 이 문서는 그 개념이 실제 스크립트 안에서 어떤 순서로 실행되는지, `performance-test/k6/smoke.js`와 `load.js` 두 파일을 코드 그대로 인용하며 처음부터 끝까지 따라간다.

## k6 스크립트가 실행되는 공통 구조

모든 k6 스크립트는 두 부분으로 나뉜다. 파일 맨 위, `export default function` 바깥에 있는 코드는 초기화 코드로 한 번만 읽힌다. `export const options`도 여기 속하며, 가상 사용자 수와 지속 시간, 임계값 같은 실행 설정을 담는다. `export default function` 안의 코드는 반복 코드로, 가상 사용자 하나가 한 번 반복할 때마다 처음부터 끝까지 실행된다. 가상 사용자가 3명이고 각자 5번 반복한다면 이 함수는 총 15번 실행된다.

반복 코드 안에서 `check()`를 호출하면 그 결과가 누적되어 최종 리포트의 `checks_total`과 `checks_succeeded`에 더해진다. `http.get()` 같은 요청 함수는 자동으로 `http_req_duration`, `http_reqs`, `http_req_failed` 같은 지표를 쌓는다. `options.thresholds`에 적어둔 조건은 스크립트가 다 끝난 뒤 이 누적된 지표를 놓고 딱 한 번 판정하며, 조건을 지키지 못하면 k6 프로세스가 실패 상태로 종료한다.

## smoke.js: 가장 단순한 형태

```javascript
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
```

`options`에서 가상 사용자를 1명, 반복을 정확히 5번으로 고정했다. 여러 명이 동시에 부하를 만드는 것이 목적이 아니라, 스크립트와 서버가 최소한 정상 동작하는지만 확인하는 것이 목적이기 때문이다. 임계값은 오류율이 정확히 0이어야 한다는 조건 하나뿐이다. 스모크 테스트에서는 단 하나의 실패도 용납하지 않는다는 뜻이다.

반복 코드는 매번 세 개의 엔드포인트를 순서대로, 정확히 같은 순서로 호출한다. 헬스체크, 공고 목록, 기술 스택 목록 순이다. 각 호출 뒤에는 곧바로 상태 코드가 200인지 확인하는 체크가 따라붙는다. 세 호출이 끝나면 1초를 쉬고 다음 반복으로 넘어간다. 가상 사용자가 1명뿐이라 이 순서는 완전히 직렬로 진행되며, 5번 반복하는 데 대략 5초에서 6초가 걸린다.

<svg viewBox="0 0 720 130" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="18" fill="#334155" font-size="13">smoke.js: VU 1개가 5회를 순서대로 반복</text>
<g fill="#334155">
<text x="20" y="45">반복 1</text><text x="20" y="70">반복 2</text><text x="20" y="95">...</text><text x="20" y="118">반복 5</text>
</g>
<rect x="80" y="35" width="30" height="16" fill="#6366f1"/><text x="115" y="47" fill="#3730a3" font-size="10">healthz</text>
<rect x="180" y="35" width="30" height="16" fill="#0891b2"/><text x="215" y="47" fill="#155e75" font-size="10">postings</text>
<rect x="280" y="35" width="30" height="16" fill="#16a34a"/><text x="315" y="47" fill="#166534" font-size="10">skills</text>
<rect x="380" y="35" width="60" height="16" fill="#e2e8f0"/><text x="450" y="47" fill="#64748b" font-size="10">sleep 1s</text>
<rect x="80" y="60" width="30" height="16" fill="#6366f1"/><rect x="180" y="60" width="30" height="16" fill="#0891b2"/><rect x="280" y="60" width="30" height="16" fill="#16a34a"/><rect x="380" y="60" width="60" height="16" fill="#e2e8f0"/>
<text x="360" y="115" fill="#64748b" font-size="11">한 반복이 끝나야 다음 반복이 시작된다(직렬)</text>
</svg>

이렇게 순서를 고정한 이유는, 스모크 테스트의 목적이 실제 트래픽을 흉내 내는 것이 아니라 세 엔드포인트가 각각 정상 응답하는지를 빠르게, 예측 가능한 순서로 확인하는 것이기 때문이다.

## load.js: 단계적으로 부하를 올리는 형태

```javascript
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
```

`BASE_URL`, `MAX_VUS`, `DURATION` 세 값은 모두 명령줄에서 `-e` 옵션으로 넘기는 환경변수를 읽는다. 스크립트 코드를 고치지 않고도, 로컬에는 가상 사용자 20명을 1분간, 프로덕션에는 5명을 20초간처럼 실행할 때마다 규모를 바꿀 수 있게 만든 부분이다.

`stages`는 시간에 따라 가상 사용자 수를 어떻게 바꿀지 정한다. 처음 20초 동안은 목표치의 4분의 1까지만 서서히 늘리고, 그다음 `DURATION` 동안 목표 인원을 그대로 유지하며, 마지막 10초 동안 0명까지 줄인다. 이렇게 서서히 늘리고 줄이는 이유는, 갑자기 인원이 나타나거나 사라지면 그 순간의 통계가 실제 부하가 아니라 시작과 종료의 충격만 반영하기 때문이다.

<svg viewBox="0 0 720 160" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="18" fill="#334155" font-size="13">load.js: 가상 사용자 수가 시간에 따라 변한다</text>
<line x1="40" y1="130" x2="680" y2="130" stroke="#94a3b8"/>
<line x1="40" y1="130" x2="40" y2="30" stroke="#94a3b8"/>
<text x="8" y="35" fill="#64748b" font-size="10">VU</text>
<polyline points="40,130 160,50 460,50 620,130" fill="none" stroke="#6366f1" stroke-width="2.5"/>
<text x="100" y="145" text-anchor="middle" fill="#64748b" font-size="10">예열 20s</text>
<text x="310" y="145" text-anchor="middle" fill="#64748b" font-size="10">유지 DURATION</text>
<text x="540" y="145" text-anchor="middle" fill="#64748b" font-size="10">정리 10s</text>
<text x="150" y="42" fill="#3730a3" font-size="10">목표치의 25%까지</text>
<text x="460" y="42" text-anchor="middle" fill="#3730a3" font-size="10">MAX_VUS 유지</text>
</svg>

반복 코드는 스모크 테스트와 다르게 매번 네 개 엔드포인트 중 하나를 무작위로 골라 딱 한 번만 호출한다. 실제 사용자가 매번 같은 순서로 페이지를 보지 않는 것을 흉내 낸 것이다. 호출 뒤에는 상태 코드만 확인하고, 0.5초에서 2초 사이의 무작위 시간을 쉰 뒤 다음 반복으로 넘어간다. 이 쉬는 시간도 실제 사용자가 요청과 요청 사이에 페이지를 읽거나 클릭을 준비하는 간격을 흉내 낸다.

가상 사용자가 여러 명이면 이 반복 코드는 각자 독립적으로, 동시에 실행된다. 예열 구간이 끝나 목표 인원에 도달하면, 그 인원 각자가 무작위 엔드포인트를 호출하고 무작위 시간을 쉬는 것을 계속 반복하면서 서버에 동시 다발적인 트래픽을 만든다.

임계값은 두 개다. 지연의 95번째 백분위수가 800밀리초를 넘지 않아야 하고, 오류율이 1퍼센트를 넘지 않아야 한다. 이 두 조건은 스모크 테스트의 오류율 0퍼센트보다 관대한데, 부하 테스트는 어느 정도의 흔들림을 감수하고 실제 부하 상황에서의 한계를 살펴보는 것이 목적이기 때문이다.

## 두 스크립트의 차이가 의미하는 것

스모크 테스트는 정해진 순서로 적은 횟수만 확인해서 스크립트와 서버의 기본 동작을 빠르게 검증하고, 부하 테스트는 무작위 순서로 여러 명이 동시에 오래 두드려서 실제와 비슷한 트래픽 패턴을 만든다. 이 둘을 항상 이 순서로, 스모크를 먼저 통과한 뒤에만 부하 테스트로 넘어가는 습관을 지킨다. 스모크가 실패한다는 것은 서버나 스크립트 자체에 문제가 있다는 뜻이라, 그 상태로 부하를 올리면 무엇이 진짜 부하 때문인지 구분할 수 없어진다.

참고로 smoke.js의 공고 목록 호출은 `?limit=10`을 쓰는데, 이 파라미터도 엔드포인트가 선언하지 않아 조용히 무시된다. 03 build-journal 문서에서 고친 페이지네이션 버그 덕분에 지금은 필터 없이 불러도 안전하지만, `limit`이라는 이름이 실제로는 아무 효과가 없다는 점은 스크립트를 읽을 때 헷갈리기 쉬운 부분이라 여기 남겨둔다.
