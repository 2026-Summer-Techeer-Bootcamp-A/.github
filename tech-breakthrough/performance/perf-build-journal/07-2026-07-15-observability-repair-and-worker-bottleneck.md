# 관측 인프라 복구와 단일 워커 병목 발견

카테고리: 성능 테스트 및 모니터링

**일정**: 2026-07-15  
**요약**: 관측 인프라 장애(Grafana 크래시 루프, 배포된 적 없던 exporter)를 복구하고, 워커 1개로 인한 처리율 붕괴라는 핵심 병목을 발견했다.  

## 도입 배경 및 문제 제기

부하 테스트를 프로덕션에 실제로 돌려보기에 앞서, 그 결과를 실시간으로 지켜볼 Grafana 대시보드부터 점검하기로 했다. 그런데 로컬에서 `localhost:3000`에 접속했을 때 화면이 뜨지 않았고, 원인을 좇는 과정에서 예상보다 훨씬 큰 문제 세 겹이 연쇄로 드러났다. 첫째는 Grafana 컨테이너 자체가 뜨지 못하고 재시작을 반복하는 문제였고, 둘째는 그 문제를 고친 뒤에도 프로덕션에서만 시스템 성능과 DB 지표가 비어 보이는 문제였으며, 셋째는 실제로 k6 부하 테스트를 프로덕션에 실행해본 뒤에야 드러난, 애플리케이션 서버 자체의 동시성 구조 문제였다. 이 문서는 그 세 겹을 순서대로 진단하고 조치한 과정을 기록한다.

## Grafana 컨테이너 크래시 루프

`docker ps`로 확인한 `backend-grafana-1`은 `Restarting (1)` 상태를 반복하고 있었다. 로그를 보면 매번 같은 지점에서 죽었다.

```
level=error msg="Failed to provision alerting" error="failure to map file contactpoints.yaml:
failure parsing contact points: discord-alerts: failed to validate integration
\"discord-alerts\" (UID discord-alerts-1) of type \"discord\": could not find webhook url property in settings"
```

바로 전날 커밋(`8108689`)에서 Discord 알림 컨택포인트<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>를 새로 추가하면서, 웹훅 URL이 비어 있으면 "알림만 조용히 실패하고 Grafana 자체는 정상 기동한다"고 가정했었다. 그런데 실제로 Grafana 11.5.2는 컨택포인트의 `url` 필드가 빈 문자열이면 프로비저닝<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 검증 단계에서 치명적 오류로 처리하고 프로세스를 즉시 종료한다. 로컬 `.env`의 `DISCORD_WEBHOOK_URL`이 주석 처리되어 있었으니 매번 빈 문자열이 주입되었고, 그 결과가 무한 재시작이었다.

수정은 `docker-compose.yml`의 기본값을 빈 문자열 대신 형식만 유효한 placeholder URL로 바꾸는 것이었다.

```yaml
- DISCORD_WEBHOOK_URL=${DISCORD_WEBHOOK_URL:-https://discord.com/api/webhooks/0/placeholder}
```

실제 웹훅이 없어도 Grafana는 정상 기동하고, 알림 전송 자체만 원래 의도했던 대로 조용히 실패한다. 재배포 후 `RestartCount=0`으로 안정화된 것을 확인했다.

## 프로덕션 관측 공백: exporter 미배포

Grafana는 떴지만 "시스템 성능"과 "DB 내용" 대시보드는 로컬에서만 값이 보이고 프로덕션에서는 계속 비어 있었다. `app-vm`에 SSH로 직접 들어가 떠 있는 컨테이너를 확인해보니 원인이 명확했다.

| 컨테이너 | 로컬 | 프로덕션 |
| :--- | :--- | :--- |
| app, traefik, prometheus, loki, alloy, tempo, grafana | 존재 | 존재 |
| node-exporter | 존재 | **없음** |
| postgres-exporter | 존재 | **없음** |
| redis-exporter | 존재 | **없음** |

세 exporter는 로컬 전용 오버레이 파일인 `docker-compose.dev.yml`에만 정의되어 있었는데, 배포 워크플로(`deploy.yml`)는 base 파일인 `docker-compose.yml`만 VM에 동기화한다. 즉 이 세 exporter는 애초에 프로덕션에 배포된 적이 없었다. `observability/prometheus.yml`은 두 환경이 공유하는 설정이라 `postgres-exporter:9187`, `node-exporter:9100`을 계속 스크레이프 시도하지만, 프로덕션에는 그 이름의 컨테이너가 없으니 조용히 데이터 없음으로 끝났을 뿐 에러 로그조차 남기지 않았다.

여기에 두 번째 함정이 있었다. dev.yml의 `postgres-exporter`/`redis-exporter` DSN<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>은 dev 컨테이너 호스트명(`db`, `redis`)에 하드코딩되어 있었는데, 프로덕션은 컨테이너 DB가 아니라 Cloud SQL과 Memorystore를 프라이빗 IP로 직접 사용한다. 그대로 옮기면 연결 자체가 안 되는 구조였다.

세 exporter를 base `docker-compose.yml`로 이전하면서, DSN을 환경별 `.env`의 `POSTGRES_EXPORTER_DSN`/`REDIS_EXPORTER_ADDR`로 분리했다. 로컬은 `db`/`redis` 컨테이너를 가리키고, 프로덕션은 `10.36.0.3:5432`(Cloud SQL)와 `10.36.31.115:6379`(Memorystore)를 가리킨다. 배포 후 프로덕션 Prometheus의 타겟 상태를 확인하니 `node`, `postgres`, `redis` 모두 `up`으로 전환되었고, 실제 메트릭 샘플도 정상적으로 들어오는 것을 확인했다.

## 대시보드 재설계

관측 파이프라인을 복구한 김에, 그동안 영문으로만 되어 있던 대시보드 네 개를 정리했다.

| 파일 | 변경 내용 |
| :--- | :--- |
| `system-perf-monitoring.json` | 전체 한국어화 |
| `db-perf-traffic.json` | 한국어화, PostgreSQL과 Redis 섹션을 각각 독립된 헤더와 통계 행을 가진 완전히 별개의 상하 블록으로 재구성 |
| `apm-fastapi-golden.json` | 기존 `webapp-apm-golden.json`과 `fastapi-perf-loadtest.json`을 중복 패널 제거하며 하나로 병합해 신설, 원본 두 파일은 삭제 |
| `load-test-monitor.json` | 신규 작성. 5초 자동 새로고침, 부하 테스트 도중 요청률, 에러율, 지연, VM 및 앱 자원, DB 커넥션 풀을 한 화면에서 보도록 구성 |

## k6 실행 과정에서 드러난 도구 버그 두 가지

대시보드가 준비된 뒤 실제로 k6를 프로덕션에 실행해보면서 관측 파이프라인과는 무관한 도구 자체의 버그 두 가지를 추가로 발견했다.

첫째, Base URL 입력란에 스킴<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup> 없이 `2026-techeer-a.duckdns.org`만 입력하면 k6가 만든 최종 요청 URL도 스킴이 없는 상태가 되고, Go HTTP 클라이언트가 이를 빈 스킴으로 파싱해 모든 요청이 `unsupported protocol scheme ""`로 즉시 실패한다. 서버는 정상이었지만 실시간 로그에는 계속 실패만 찍혔다.

둘째, k6-analyzer TUI의 실시간 지표 패널(VU 수, 요청 수, 지연 시간, 에러율)이 테스트가 진행되는 동안 계속 빈칸으로 남아 있었다. 원인은 k6 자체의 동작 변경이었다. 설치된 `k6 v2.1.0`은 REST API 서버를 기본으로 비활성화하며, `--address`(`-a`)를 명시해야만 켜진다.

```
-a, --address string   address for the REST API server (e.g. localhost:6565);
                        the server is disabled when not set
```

`analyzer.py`는 이 플래그 없이 k6를 실행하고 있었고, 실시간 폴링 코드는 예외를 조용히 삼키도록(`except Exception: pass`) 작성되어 있어 연결 실패가 화면에 아무 신호도 남기지 않았다. `run_k6_test()`가 만드는 명령어에 `-a localhost:6565`를 추가하는 것으로 해결했다.

## 핵심 발견: 워커 1개와 처리율 붕괴

도구 문제를 해결한 뒤 `load.js`를 `MAX_VUS=200`, `DURATION=90s`로 프로덕션에 실행했다. 결과가 예상 밖이었다. 200 VU를 투입했는데도 프로덕션 Prometheus에 남은 실제 처리율은 테스트 구간 전체에서 최대 2.36 req/s를 넘긴 적이 없었다.<sup class="fnref" id="fnref6"><a href="#fn6">6</a></sup>

| 시각(UTC) | 요청 처리율 | 앱 프로세스 CPU |
| :--- | :--- | :--- |
| 07:10:50 | 0.29 req/s | 3.9% |
| 07:11:20 | 1.58 req/s | 17.8% |
| 07:16:00 | 2.18 req/s | 22.2% |
| **07:16:30** | **2.36 req/s (구간 내 최댓값)** | **28.1%** |
| 07:17:00 | 1.42 req/s | 21.2% |

VM은 2 vCPU(e2-standard-2)인데 앱 프로세스 CPU 사용률은 최댓값이 한 코어의 28% 수준에 그쳤다. 처리율은 바닥인데 CPU는 거의 안 바쁜 이 조합이 핵심 단서였다. 연산량이 많아서 느려지는 것이라면 이벤트 루프<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup>가 있는 코어 하나는 100%에 가깝게 찼어야 한다. 그렇지 않다는 것은 요청들이 연산이 아니라 대기 상태에 머물러 있다는 뜻이다.

컨테이너의 실행 커맨드를 확인하자 원인이 드러났다.

```
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`--workers` 옵션이 없다. Uvicorn은 이 경우 단일 워커, 단일 이벤트 루프로 동작한다. 이전 조사(06번 문서)에서 이미 `stats_heavy` 계열 엔드포인트가 raw aggregation 쿼리로 DB 커넥션을 몇 초씩 동기적으로 붙잡는 특성이 확인된 바 있는데, 그 블로킹 호출이 비동기 핸들러 내부에서 스레드로 위임되지 않은 채 실행된다면 요청 하나가 이벤트 루프 전체를 그 시간만큼 정지시킨다. 워커가 하나뿐이므로 이 정지는 서버 전체의 정지와 같다. 200 VU가 동시에 요청을 보내도 실제로는 한 번에 하나씩만, 그것도 무거운 요청 뒤에서 오래 기다리며 처리된 것이다.

<figure class="fig">
<svg viewBox="0 0 720 240" width="100%" style="height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="단일 워커에서 블로킹 호출이 전체 요청을 정지시키는 구조">
<defs>
<marker id="arw-perf-7" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto">
<path d="M0,0 L7,3 L0,6 Z" fill="#5b5e66"/>
</marker>
</defs>
<style>
.bx{fill:#eef2f9;stroke:#21447c;stroke-width:1.4;}
.bxHeavy{fill:#fce8e6;stroke:#c5221f;stroke-width:1.4;}
.bxBlock{fill:#f1f3f4;stroke:#5b5e66;stroke-dasharray:4;stroke-width:1.4;}
.tl{font-family:Pretendard,sans-serif;font-size:14px;font-weight:700;fill:#21447c;}
.tx{font-family:Pretendard,sans-serif;font-size:12px;fill:#1a1c20;text-anchor:middle;}
.sm{font-family:Pretendard,sans-serif;font-size:10px;fill:#5b5e66;text-anchor:middle;}
.fl{stroke:#5b5e66;stroke-width:1.3;}
</style>
<text x="10" y="24" class="tl">1. 200 VU 동시 유입</text>
<rect class="bx" x="10" y="44" width="150" height="150" rx="6"/>
<text class="tx" x="85" y="70">요청 1..200</text>
<text class="sm" x="85" y="88">전부 대기열에서</text>
<text class="sm" x="85" y="102">순서를 기다림</text>
<text x="230" y="24" class="tl">2. 단일 워커, 단일 이벤트 루프</text>
<rect class="bxHeavy" x="230" y="44" width="220" height="60" rx="4"/>
<text class="tx" x="340" y="68">stats_heavy 쿼리 처리 중</text>
<text class="sm" x="340" y="84">동기 DB 호출이 루프를 점유</text>
<rect class="bxBlock" x="230" y="114" width="220" height="80" rx="4"/>
<text class="tx" x="340" y="140">나머지 199개 요청</text>
<text class="sm" x="340" y="156">전부 정지 상태로 대기</text>
<text class="sm" x="340" y="172">CPU는 대부분 유휴</text>
<text x="520" y="24" class="tl">3. 실측 결과</text>
<rect class="bx" x="520" y="44" width="180" height="150" rx="6"/>
<text class="tx" x="610" y="80">처리율 최대 2.36 req/s</text>
<text class="tx" x="610" y="104">CPU 최대 28%(1코어)</text>
<text class="sm" x="610" y="130">2코어 중 대부분 유휴</text>
<text class="sm" x="610" y="146">워커 1개라 병렬화 안 됨</text>
<line class="fl" x1="160" y1="119" x2="220" y2="119" marker-end="url(#arw-perf-7)"/>
<line class="fl" x1="450" y1="119" x2="510" y2="119" marker-end="url(#arw-perf-7)"/>
</svg>
<figcaption>그림 1. 워커 1개 구조에서 블로킹 호출 하나가 200 VU 전체를 대기시키는 흐름</figcaption>
</figure>

## 다음 단계

이번 발견은 06번 문서에서 규명한 "커넥션 풀 경합"과 같은 뿌리에서 나온 다른 증상이다. 그때는 여러 워커/여러 커넥션이 존재한다는 전제 위에서 커넥션 풀이 경합하는 문제를 다뤘다면, 이번에는 워커가 애초에 하나뿐이라 경합할 병렬성 자체가 없었다는 사실을 확인했다. 대응은 두 갈래로 이어진다. 서버 사양(2 vCPU)에 맞춰 Uvicorn 워커 수를 늘려 최소한의 병렬 처리 능력을 확보하는 단기 조치와, 요청 처리 경로에서 이벤트 루프를 점유하는 동기 블로킹 호출을 찾아 제거하거나 스레드로 위임하는 근본 조치다. 워커만 늘리고 블로킹 호출을 그대로 두면 워커 수만큼만 병목이 완화될 뿐 같은 현상이 더 높은 VU에서 재현될 것이므로, 두 조치는 순서보다 병행이 중요하다. 이어지는 작업에서 다룬다.

## 배운 점

이번 조사는 하나의 증상처럼 보였던 문제("대시보드가 안 보인다")가 사실은 서로 다른 층위의 세 가지 결함이 겹쳐 나타난 것이었다는 점을 보여준다. 관측 도구 자체의 장애, 관측 파이프라인의 배포 공백, 그리고 관측 대상인 애플리케이션의 실제 구조적 병목은 각각 다른 원인과 다른 해법을 요구했고, 겉으로 드러난 증상만 보고 성급하게 하나로 묶었다면 엉뚱한 곳을 고쳤을 것이다. 특히 "CPU는 안 바쁜데 처리율은 바닥"이라는 조합은 그 자체로 결론이 아니라 질문이었다. 연산 부족이 아니라 대기 상태를 의심하게 만드는 신호였고, 그 신호를 따라 워커 설정까지 내려가서야 비로소 근본 원인에 닿을 수 있었다. 부하 테스트의 수치는 항상 그 수치가 왜 그렇게 나왔는지를 구조적으로 설명할 수 있어야 신뢰할 수 있다.

<hr>
<ol class="footnotes">
<li id="fn1">Grafana Alerting에서 알림을 실제로 어디로 보낼지(Discord, Slack, 이메일 등) 정의하는 설정 단위. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">설정 파일을 미리 정해진 경로에 두면 애플리케이션이 기동 시 자동으로 읽어 적용하는 방식. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">Data Source Name. 데이터베이스 접속에 필요한 사용자, 비밀번호, 호스트, 포트, DB 이름을 하나의 문자열로 표현한 것. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">URL에서 <code>https://</code>처럼 프로토콜을 지정하는 맨 앞부분. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">비동기 프로그램에서 여러 작업을 하나의 스레드가 번갈아 처리하도록 조율하는 실행 단위. 동기 블로킹 호출이 끼어들면 그 시간 동안 다른 모든 작업이 멈춘다. <a class="fnback" href="#fnref5">↩</a></li>
<li id="fn6">이 절의 처리율·CPU 표는 2026-07-15 프로덕션에 <code>MAX_VUS=200, DURATION=90s</code>로 실행한 동안 프로덕션 Prometheus가 실제로 수집한 시계열 값을 그대로 옮긴 것이다. <a class="fnback" href="#fnref6">↩</a></li>
</ol>
