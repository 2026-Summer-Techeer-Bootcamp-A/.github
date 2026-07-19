# 부하 테스트 (k6)

## k6가 하는 일

k6는 스크립트(JavaScript)로 가상 사용자(VU, Virtual User)를 여러 개 띄워 API에
동시 요청을 보내는 부하 테스트 도구다. 한 VU는 한 명의 동시 사용자를 흉내 내며,
스크립트의 `default function`을 반복 실행한다. VU 수와 지속 시간을 단계별로
조절해(`stages`) 트래픽 패턴을 만들고, 응답 시간과 에러율에 기준선(`thresholds`)을
정해 통과/실패를 판정한다.

테스트 종류는 목적에 따라 나뉜다.

| 종류 | VU 패턴 | 목적 |
|---|---|---|
| smoke | 1 VU, 몇 번만 | 스크립트와 서버가 최소한 정상 동작하는지 확인 |
| load | 예상 트래픽 수준으로 서서히 증가 | 평상시 부하에서의 지연/처리량 측정 |
| stress | 한계까지 계속 증가 | 어디서 무너지는지(병목) 찾기 |
| spike | 순간적으로 급증 | 갑작스런 트래픽 폭증 대응력 확인 |
| soak | 오랜 시간 일정 부하 유지 | 메모리 누수, 서서히 느려지는 문제 발견 |

이 폴더는 smoke와 load 두 가지만 우선 제공한다. stress/spike/soak은 필요할 때
같은 패턴으로 `options.stages`만 바꿔 추가하면 된다.

## 이 프로젝트에서는 별도 연동이 필요 없다

FastAPI 앱은 이미 `prometheus_fastapi_instrumentator`로 모든 요청의 처리량과
지연을 `/metrics`에 노출하고 있고, Prometheus가 5초마다 이를 긁어가며, Grafana의
`FastAPI Backend — Load & Performance` 대시보드가 그 수치를 실시간으로 그린다.
k6는 그냥 트래픽을 만들기만 하면 되고, 그 결과는 자동으로 이 대시보드에 나타난다.
k6 쪽에서 Prometheus에 따로 값을 보내는 별도 설정은 필요 없다.

부하 테스트를 돌리는 동안 Grafana에서 이 대시보드를 열어두고 Throughput, p50/p95/p99,
Error Rate 패널을 보면서 실시간으로 관찰한다.

## 설치

```
brew install k6          # macOS
# 또는 https://k6.io/docs/get-started/installation/ 참고
```

## 절대 건드리지 말 것

- `/api/v1/chat` — Gemini API를 호출한다. 반복 요청은 실제 비용으로 이어진다.
- `/api/v1/resume/parse` — 파일 파싱과 LLM 피드백을 포함해 무겁고, 세션 상태를 만든다.
- 모든 POST/PUT/DELETE 엔드포인트 — 쓰기 작업이라 반복 실행하면 더미 데이터가 쌓이거나
  실제 데이터가 오염된다.

`load.js`는 읽기 전용 GET 엔드포인트(`/healthz`, `/api/v1/postings`, `/skills`,
`/api/v1/job-categories`)만 대상으로 한다. 다른 엔드포인트를 추가할 때도 이 기준을
지킨다.

## 실행 순서

### 1. 로컬 dev 스택에서 먼저 돌린다

```
cd backend && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d && cd ..
k6 run -e BASE_URL=http://localhost:8000 performance-test/k6/smoke.js
k6 run -e BASE_URL=http://localhost:8000 performance-test/k6/load.js
```

로컬은 마음껏 세게 돌려도 된다. 실제 사용자나 비용에 영향이 없다.

### 2. 프로덕션은 소규모로만, 짧게

프로덕션 VM은 2 vCPU/8GB에 관측성 스택 전체가 함께 돌고, Cloud SQL은 최근 비용
절감을 위해 1 vCPU/3.75GB로 낮춰둔 상태다. 여기에 큰 부하를 걸면 다른 접속자나
데모 시연에 지장을 주거나, DB가 병목이 되어 자기 자신에게 장애를 일으킬 수 있다.
그래서 프로덕션에서는 항상 VU 수와 시간을 크게 줄여서 짧게만 확인한다.

```
k6 run -e BASE_URL=https://2026-techeer-a.duckdns.org \
       -e MAX_VUS=5 -e DURATION=20s \
       performance-test/k6/load.js
```

돌리는 동안 Grafana(`https://grafana.2026-techeer-a.duckdns.org`)에서 위 대시보드를
보며 p95/에러율이 튀는지 살펴본다. 이상 징후가 보이면 즉시 Ctrl+C로 중단한다.

## 결과 읽는 법

k6는 실행이 끝나면 터미널에 요약을 출력한다.

- `http_req_duration` — 요청 왕복 시간. `p(95)`가 임계값(load.js는 800ms)을
  넘으면 thresholds가 실패로 표시된다.
- `http_req_failed` — 실패율. 1%를 넘으면 실패로 표시된다.
- `checks` — 스크립트에 적어둔 `check()` 조건의 통과율.

임계값 실패는 빌드를 막는 용도가 아니라, "이번 부하 수준에서 목표를 못 지켰다"는
신호로 보고 원인을 Grafana에서 같이 확인한다. p95가 튀면 어느 엔드포인트가
느려졌는지 대시보드의 Endpoint Ranking 패널로 좁혀나간다.

## 다음 단계 (선택)

지금은 k6 쪽 지표(VU 수, 반복 시간)를 터미널에서만 보고 서버 쪽 지표(처리량,
지연, 에러율)를 Grafana에서 본다. 두 화면을 오가는 것이 불편해지면, k6의
실험적 Prometheus remote-write 출력(`k6 run --out experimental-prometheus-rw`)을
붙여서 VU 수 같은 클라이언트 지표도 같은 Grafana 대시보드에 합칠 수 있다. 이때는
Prometheus에 `--web.enable-remote-write-receiver` 플래그가 필요하며, 지금은
필요하지 않으므로 켜두지 않았다.
