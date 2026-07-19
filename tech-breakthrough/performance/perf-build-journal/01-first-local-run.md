# 첫 실행: 로컬에서 스모크와 부하 테스트를 돌린다

## 목표

k6를 설치하고, 로컬 개발 스택을 대상으로 스모크 테스트와 부하 테스트를 실제로 돌려서 스크립트가 의도대로 동작하는지, 그리고 기존 관측 파이프라인이 정말 새 연동 없이 결과를 잡아내는지 확인한다.

## k6 설치

패키지 저장소를 새로 추가하지 않고, 공식 릴리스의 정적 바이너리를 내려받아 PATH에 이미 있는 사용자 로컬 bin 디렉터리에 놓는 방식을 택했다. 시스템 전역 설정을 건드리지 않아 되돌리기도 쉽다.

```
k6 version
# k6 v2.1.0 (commit/83a87a41e2, go1.26.4, linux/amd64)
```

## 스모크 테스트 결과

로컬 개발 스택(`docker-compose.yml` + `docker-compose.dev.yml`)이 이미 떠 있는 상태에서 스모크 테스트를 돌렸다.

```
k6 run -e BASE_URL=http://localhost:8000 performance-test/k6/smoke.js
```

15개 체크 중 15개가 통과했고 오류율은 0퍼센트였다. 헬스체크, 공고 목록, 기술 스택 목록 세 엔드포인트가 모두 정상 응답했다. 이 시점에서 스크립트 자체에는 문제가 없다는 것이 확인됐다.

## 부하 테스트 결과

이어서 부하 테스트를 돌렸다. 20초에 걸쳐 5명까지 서서히 늘리고, 1분 동안 20명을 유지하고, 마지막 10초에 걸쳐 줄이는 패턴이다.

```
k6 run -e BASE_URL=http://localhost:8000 performance-test/k6/load.js
```

<figure class="fig">
<svg viewBox="0 0 640 200" role="img" aria-label="스모크 테스트에서 부하 테스트를 거쳐 관측 파이프라인을 확인하기까지의 흐름도">
<defs>
<marker id="arrow01" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
<path d="M0,0 L10,5 L0,10 z" fill="#21447c"></path>
</marker>
</defs>
<rect x="10" y="20" width="135" height="90" rx="10" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="77" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">로컬 스택 기동</text>
<text x="77" y="72" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">Docker Compose</text>
<text x="77" y="90" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">dev 스택</text>
<line x1="147" y1="65" x2="163" y2="65" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow01)"></line>
<rect x="165" y="20" width="135" height="90" rx="10" fill="#eef2f9" stroke="#21447c"></rect>
<text x="232" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#21447c">스모크 테스트</text>
<text x="232" y="72" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">smoke.js</text>
<text x="232" y="90" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">15/15 체크 통과</text>
<line x1="302" y1="65" x2="318" y2="65" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow01)"></line>
<rect x="320" y="20" width="165" height="90" rx="10" fill="#eef2f9" stroke="#21447c"></rect>
<text x="402" y="38" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#21447c">부하 테스트</text>
<text x="402" y="53" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">load.js · VU 0→5→20→0</text>
<polyline points="335,100 362,90 362,60 442,60 455,100" fill="none" stroke="#21447c" stroke-width="2"></polyline>
<line x1="335" y1="100" x2="465" y2="100" stroke="#c9ccd3" stroke-width="1"></line>
<text x="402" y="112" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="9.5" fill="#8a8d95">0s → 90s</text>
<line x1="487" y1="65" x2="503" y2="65" stroke="#21447c" stroke-width="1.5" marker-end="url(#arrow01)"></line>
<rect x="505" y="20" width="125" height="90" rx="10" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="567" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="13" font-weight="700" fill="#1a1c20">관측 확인</text>
<text x="567" y="72" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">Prometheus</text>
<text x="567" y="90" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">→ Grafana</text>
<text x="320" y="145" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="600" fill="#1a1c20">701건 요청 · 오류율 0.00% · p95 156.48ms</text>
<text x="320" y="163" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" fill="#5b5e66">임계값(p95 &lt; 800ms, 오류율 &lt; 1%) 모두 통과</text>
</svg>
<figcaption><b>그림 1.</b> 스모크 테스트로 스크립트 정합성을 먼저 확인한 뒤, 부하 테스트로 VU를 단계적으로 올려 기존 Prometheus·Grafana 파이프라인이 그대로 잡아내는지 검증하는 흐름이다.</figcaption>
</figure>

결과는 다음과 같았다.

| 지표 | 값 |
|---|---|
| 총 요청 수 | 701건 |
| 오류율 | 0.00% |
| p90 지연 | 122.82ms |
| p95 지연 | 156.48ms |
| 최대 지연 | 277.32ms |
| 최대 동시 가상 사용자 | 20 |

스크립트에 적어둔 두 임계값<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> 모두 통과했다. p95 지연은 800밀리초 미만이어야 했는데 실제로는 156밀리초로 여유가 컸고, 오류율은 1퍼센트 미만이어야 했는데 실제로는 0퍼센트였다. 로컬 환경에서 가상 사용자<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 20명 수준의 부하는 이 API에 전혀 부담이 되지 않았다는 뜻이다. 개념서 01 문서에서 정리한 Apdex 기준으로 보면, 만족 기준 시간 500밀리초를 기준으로 p95조차 그 3분의 1 수준이라 이 부하에서는 거의 모든 요청이 만족 구간에 들었다고 볼 수 있다.

## 기존 관측 파이프라인의 포착 여부

가장 확인하고 싶었던 것은 이것이었다. k6 쪽에서 아무 설정도 추가하지 않았는데, 정말 기존 Prometheus와 Grafana가 이 트래픽을 잡아내는지였다. 로컬 개발 스택에도 Grafana와 Prometheus 컨테이너가 함께 떠 있다는 것을 확인한 뒤, 부하 테스트가 끝난 직후 Prometheus에 직접 최근 5분간의 요청 증가량을 물었다.<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>

```
increase(http_requests_total{job="app"}[5m])
```

응답은 다음과 같았다.

| 엔드포인트 | 5분간 요청 수 |
|---|---|
| /healthz | 191.2 |
| /api/v1/postings | 202.2 |
| /skills | 204.3 |
| /api/v1/job-categories | 172.5 |
| /metrics (Prometheus 자체 스크레이핑) | 60.0 |

네 엔드포인트가 정확히 분리되어 잡혔고, 합계는 스모크와 부하 테스트를 합친 요청 수와 정확히 맞아떨어졌다. k6가 만든 트래픽에 대해 별도의 계측 코드를 한 줄도 추가하지 않았는데도, API 서버의 기존 계측과 Prometheus의 기존 스크레이핑이 그대로 잡아낸 것이다. 00 문서에서 예상했던 대로, 이 프로젝트는 부하 테스트 도구를 붙이는 것만으로 관측이 완성되는 상태였다는 것이 실측으로 확인됐다.

## 배운 것

로컬에서 가상 사용자 20명은 이 API에 아무런 압박이 되지 않았다. 다음 단계로 스트레스 테스트를 돌려 실제로 어디서 무너지는지 찾아볼 수도 있지만, 지금 목표는 정상 동작 확인이었으므로 여기서는 무리하지 않았다.

더 중요한 확인은 파이프라인 쪽이었다. 계측, 수집, 시각화가 이미 갖춰져 있다는 00 문서의 판단이 실제로 맞았고, 앞으로 프로덕션에 소규모로 부하를 걸 때도 같은 방식으로 Grafana 대시보드만 보면 된다는 것이 이번 로컬 실행으로 검증됐다.

## 남은 것

다음 단계는 프로덕션에 아주 작은 규모로 짧게 부하를 걸어보는 것이다. `k6/README.md`에 적어둔 대로 가상 사용자 5명, 20초 정도로 시작하고, Grafana 대시보드를 보면서 이상 징후가 없는지 확인한 뒤에만 규모를 조금씩 늘린다.

<hr>
<ol class="footnotes">
<li id="fn1">k6 스크립트에 코드로 명시하는 통과 기준. 예를 들어 <code>p(95)&lt;800</code>은 p95 지연이 800밀리초를 넘으면 테스트 자체를 실패로 처리하라는 뜻이다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">Virtual User. k6가 하나의 시나리오를 반복 실행하는 논리적 사용자 단위로, 실제 브라우저나 사람이 아니라 병렬로 요청을 보내는 실행 스레드에 가깝다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">Prometheus의 질의 언어 PromQL이 제공하는 함수. 대상 시계열이 지정한 기간 동안 얼마나 늘었는지를 계산해, 카운터 지표의 구간별 증가량을 바로 확인할 수 있게 해준다. <a class="fnback" href="#fnref3">↩</a></li>
</ol>
