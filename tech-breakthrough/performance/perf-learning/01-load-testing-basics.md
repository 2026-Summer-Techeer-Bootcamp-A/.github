# 부하 테스트 기초: 가상 사용자, 처리량, 지연, 백분위수

## 개요

이 문서는 부하 테스트를 처음 접하는 사람을 위한 개념서다. 가상 사용자가 무엇인지, 처리량과 지연과 동시성이 서로 어떤 관계인지, 평균 대신 백분위수를 보는 이유가 무엇인지, 그리고 목적에 따라 테스트를 어떻게 나누는지를 순서대로 설명한다. 도구로는 k6를 예로 든다.

## 가상 사용자(VU)의 정의

부하 테스트 도구는 실제 사람 대신 프로그램으로 요청을 흉내 낸다. 이 흉내를 내는 하나의 단위를 가상 사용자라 부른다. k6에서 가상 사용자는 스크립트를 반복 실행하는 독립된 실행 흐름이며, 이해를 돕기 위해 표현하면 끝없이 반복하는 하나의 반복문과 같다[1]. 가상 사용자를 10개 띄우면 10명이 동시에 접속한 것처럼, 100개를 띄우면 100명이 동시에 접속한 것처럼 서버에 요청이 쏟아진다.

가상 사용자 수를 시간에 따라 어떻게 바꿀지 정하는 것을 부하 패턴이라 부른다. 처음에는 적게 시작해서 서서히 늘리고, 목표 수준에서 얼마간 유지한 뒤, 다시 서서히 줄이는 형태가 흔하다. 급하게 늘리면 서버가 아니라 테스트 스크립트 자체의 문제로 오해할 결과가 나올 수 있어서, 서서히 늘리는 구간을 둔다.

## 처리량, 지연, 동시성의 관계

부하 테스트 결과를 읽을 때 나오는 세 가지 숫자가 있다. 처리량은 초당 몇 건의 요청을 처리했는지를 말하고, 지연은 한 요청이 응답을 받기까지 걸린 시간을 말하며, 동시성은 그 순간 서버 안에서 처리 중인 요청이 몇 건인지를 말한다. 이 세 값은 독립적이지 않다.

이 관계를 정리한 것이 리틀의 법칙이다. 평균 동시성은 평균 처리량과 평균 지연을 곱한 값과 같다[2].

```
동시성 = 처리량 × 지연
```

이 식이 실무에서 중요한 이유는, 지연이 늘어나면 새 요청이 더 들어오지 않아도 동시성이 저절로 늘어난다는 것을 보여주기 때문이다. 처리량이 그대로인데 한 요청이 처리되는 시간이 두 배로 늘면, 서버 안에 쌓여 있는 요청 수도 두 배로 늘어난다. 이 관계는 세 값 중 두 개를 알면 나머지 하나를 계산할 수 있을 만큼 일반적이어서, 어떤 값을 재기 어려울 때 다른 두 값으로부터 추정하는 데도 쓴다[3].

<svg viewBox="0 0 720 210" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="20" fill="#334155" font-size="13">지연이 늘면 동시성도 늘어난다 (처리량은 그대로)</text>
<text x="120" y="45" text-anchor="middle" fill="#64748b" font-size="11">평소</text>
<rect x="60" y="55" width="16" height="16" fill="#16a34a"/>
<rect x="90" y="55" width="16" height="16" fill="#16a34a"/>
<text x="120" y="90" text-anchor="middle" fill="#166534" font-size="10">동시 처리 2건</text>
<text x="120" y="106" text-anchor="middle" fill="#64748b" font-size="10">지연 짧음</text>
<text x="330" y="45" text-anchor="middle" fill="#64748b" font-size="11">지연이 2배로 늘면</text>
<rect x="240" y="55" width="16" height="16" fill="#dc2626"/>
<rect x="270" y="55" width="16" height="16" fill="#dc2626"/>
<rect x="300" y="55" width="16" height="16" fill="#dc2626"/>
<rect x="330" y="55" width="16" height="16" fill="#dc2626"/>
<text x="330" y="90" text-anchor="middle" fill="#991b1b" font-size="10">동시 처리 4건</text>
<text x="330" y="106" text-anchor="middle" fill="#64748b" font-size="10">같은 처리량인데 쌓임</text>
<text x="520" y="80" fill="#94a3b8" font-size="14">동시성 = 처리량 × 지연</text>
<text x="360" y="160" text-anchor="middle" fill="#64748b" font-size="11">새 요청이 더 들어오지 않아도, 느려지는 것만으로 서버가 붐빈다</text>
</svg>

## 평균 대신 백분위수 사용

지연을 요약할 때 평균을 쓰면 오해하기 쉽다. 지연 분포는 대개 대칭이 아니라 한쪽으로 길게 늘어진 모양을 띠는데, 아주 느린 소수의 요청이 평균을 실제 사용자 경험보다 훨씬 나쁘게(또는 반대로 착각하게) 끌고 갈 수 있기 때문이다[4].

그래서 백분위수를 쓴다. p50은 요청의 절반이 이보다 빠르다는 뜻으로 전형적인 사용자가 겪는 속도를 보여주고, p95는 나머지 5퍼센트가 이보다 느리다는 뜻으로 꼬리 구간에 문제가 생기기 시작하는 지점을 보여주며, p99는 가장 느린 1퍼센트를 보여주는데 이 구간에는 결제나 관리자 기능처럼 중요한 요청이 섞여 있는 경우가 많다[4][5]. 실무에서는 평균 하나만 보지 않고 p50으로 보통의 경험을, p95로 전반적인 꼬리 성능을, p99로 구조적인 병목을 나눠서 본다[4].

## Apdex: 만족도를 하나의 점수로

백분위수는 정밀하지만 한눈에 좋다 나쁘다를 말해주지는 않는다. 이를 보완하는 지표가 Apdex다. 만족 기준 시간 T를 정해두고, 응답이 T 이하면 만족, T 초과 4T 이하면 참을 만함, 4T를 넘거나 오류가 나면 불만으로 분류한 뒤, 만족에는 점수 1을 참을 만함에는 0.5를 불만에는 0을 매겨 평균을 낸다[6][7].

```
Apdex = (만족 건수 + 참을 만함 건수 / 2) / 전체 건수
```

결과는 0에서 1 사이의 하나의 숫자로 나오고, 1에 가까울수록 사용자 만족도가 높다는 뜻이다[6]. 이 프로젝트가 참고하는 대시보드는 만족 기준 시간을 500밀리초로 두고 있다.

## 테스트 목적에 따른 종류 차이

같은 도구로도 목적에 따라 테스트를 다르게 설계한다. k6 공식 문서를 비롯한 성능 테스트 실무에서는 대략 다음과 같이 나눈다[8].

| 종류 | 가상 사용자 패턴 | 목적 |
|---|---|---|
| 스모크 | 1명, 몇 번만 | 스크립트와 서버가 최소한 정상 동작하는지 확인 |
| 부하 | 예상 트래픽 수준으로 서서히 증가 | 평상시 부하에서의 지연과 처리량 확인 |
| 스트레스 | 한계까지 계속 증가 | 어디서 무너지는지 찾기 |
| 스파이크 | 순간적으로 급증 | 갑작스런 트래픽 폭증 대응력 확인 |
| 소크 | 오랜 시간 일정 부하 유지 | 메모리 누수나 서서히 느려지는 문제 발견 |

k6 스크립트에서는 통과와 실패의 기준을 임계값으로 명시한다. 예를 들어 p95 지연이 500밀리초 미만이어야 한다거나 오류율이 1퍼센트 미만이어야 한다는 조건을 코드에 그대로 적어두면, 테스트가 끝났을 때 그 조건을 지켰는지 자동으로 판정한다[1].

```javascript
export const options = {
  thresholds: {
    http_req_duration: ["p(95)<500"], // p95 지연 500ms 미만
    http_req_failed: ["rate<0.01"],   // 오류율 1% 미만
  },
};
```

## 정리

부하 테스트를 읽는 눈은 결국 세 가지로 좁혀진다. 가상 사용자 수로 부하의 크기를 조절하고, 리틀의 법칙으로 지연이 늘면 동시성도 함께 늘어난다는 것을 이해하고, 평균이 아니라 백분위수로 실제 사용자가 겪는 경험을 읽는다. 이 세 가지를 갖추면 어떤 도구를 쓰든 결과를 올바르게 해석할 수 있다.

## 참고 자료

1. [Running large tests (Grafana k6 documentation)](https://grafana.com/docs/k6/latest/testing-guides/running-large-tests/)
2. [Little's Law and Concurrency: Why Your System Gets Slow When It's Busy](https://medium.com/@rajesh.sgr/littles-law-and-concurrency-why-your-system-gets-slow-when-it-s-busy-a0fbee7f303b)
3. [Understanding Little's Law](https://shekhargulati.com/2021/11/20/understanding-littles-law/)
4. [P50 vs P95 vs P99 Latency Explained](https://oneuptime.com/blog/post/2025-09-15-p50-vs-p95-vs-p99-latency-percentiles/view)
5. [What Is P99 Latency? (Aerospike)](https://aerospike.com/blog/what-is-p99-latency/)
6. [Apdex (Wikipedia)](https://en.wikipedia.org/wiki/Apdex)
7. [Apdex: Measure user satisfaction (New Relic Documentation)](https://docs.newrelic.com/docs/apm/new-relic-apm/apdex/apdex-measure-user-satisfaction/)
8. [Test for performance (Grafana k6 documentation)](https://grafana.com/docs/k6/latest/examples/get-started-with-k6/test-for-performance/)
