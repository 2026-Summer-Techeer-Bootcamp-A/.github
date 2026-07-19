# 11. Before 실측: 부하 + AI 채팅 스파이크 통합 (8GB)

**일정**: 2026-07-16
**분류**: `stability` — 09번 계획의 축 A/B/C Before 실행 기록 (부하 + AI 채팅 스파이크 통합 기준)
**요약**: app-vm을 코어는 유지하고 RAM만 8GB로 줄인 `e2-custom-4-8192` 위에서, 실제 서비스의 AI 채팅 기능(BGE-M3 임베딩 지연 로딩, RAM 약 2.6GB 소비)을 축 A·C에 실제로 끼워 넣어 얻은 Before 결과다. 사전 준비(VM 스냅샷, toggle.sh, 커널 baseline)는 10번 문서 참고. 원본 로그는 `results/before-8gb/`에 전부 보존돼 있다.

---

## 환경과 통합 방식

리사이즈:
```
gcloud compute instances stop app-vm --zone=asia-northeast3-a
gcloud compute instances set-machine-type app-vm --zone=asia-northeast3-a --machine-type=e2-custom-4-8192
gcloud compute instances start app-vm --zone=asia-northeast3-a
```
```
               total        used        free      shared  buff/cache   available
Mem:            7944        1533        5611           1        1032        6411
```

AI 채팅(BGE-M3) 단독 실측 — 벡터 검색 경로를 타는 질문으로 호출:
```
$ curl -X POST https://2026-techeer-a.duckdns.org/api/v1/chat \
    -d '{"question": "재택근무 가능하고 신입도 성장할 수 있는 분위기의 백엔드 공고 찾아줘"}'
HTTP 200, 47.480476s   route: vector

호출 전: app-app-1   758.6MiB / 7.759GiB   9.55%
호출 후: app-app-1   2.594GiB / 7.759GiB   33.43%
```
758MiB → 2.594GiB로, 코드 주석의 "RAM 2~3GB" 예상과 일치했다. 이 스파이크를 축 A는 T0+90초, 축 C는 T0+150초 지점에 실제 부하/스트레스와 겹치도록 예약해서 쐈다.

---

## 축 A: 재조정 스트레스 + AI 채팅

파라미터: 호스트 3G/240s + 2G/210s, 제한 없는 컨테이너 안 1G leak/220s, T0+90s에 `/chat` 벡터 질의.

### 1차 시도: 컨테이너 leak 미작동

```
container leak start = 11:48:04
Error response from daemon: container ... is not running

$ docker ps -a --filter name=leaky-batch
NAMES         STATUS
leaky-batch   Exited (137) 17 minutes ago
```
`leaky-batch`를 만들 때 `--restart` 정책을 안 줘서, VM 리사이즈(stop/start) 때 죽은 채 방치된 것이었다. `docker start leaky-batch && docker update --restart unless-stopped leaky-batch`로 고치고, `app-app-1`도 재시작해 BGE를 언로드 상태로 되돌린 뒤 재실행했다.

### 재실행 결과

```
[Thu Jul 16 11:56:56 2026] python3.12 invoked oom-killer: gfp_mask=0x140cca(...), oom_score_adj=0
[Thu Jul 16 11:56:58 2026] Out of memory: Killed process 6398 (stress-ng-vm) total-vm:3253748kB, anon-rss:3147204kB, ...
[Thu Jul 16 11:57:05 2026] traefik invoked oom-killer: gfp_mask=0x140cca(...), oom_score_adj=0
[Thu Jul 16 11:57:06 2026] Out of memory: Killed process 6529 (stress-ng-vm) total-vm:3253748kB, anon-rss:3106628kB, ...
[Thu Jul 16 11:59:22 2026] python3.12 invoked oom-killer: ...
[Thu Jul 16 11:59:23 2026] Out of memory: Killed process 6534 (stress-ng-vm) total-vm:3253748kB, anon-rss:3147064kB, ...
[Thu Jul 16 11:59:31 2026] systemd[1]: session-24.scope: A process of this unit has been killed by the OOM killer.
```
```
stress-ng: info:  [6519] note: system has only 123 MB of free memory and swap, recommend using --oom-avoid
```

OOM 3회 모두 죽은 건 `stress-ng-vm`이었지만, **정작 메모리를 못 받아 OOM 경로를 트리거한 건 `python3.12`(app-app-1 자신)와 `traefik`**이었다 — app이 실제로 압박받는 상황까지 몰린 걸 dmesg로 직접 확인한 첫 사례다. 가용 메모리 최저치는 **135MB**(`mem.log`).

AI 채팅 결과 — 이번엔 실패:
```
$ cat chat.log
HTTP 502, 18.528762s
Bad Gateway
```
격리 테스트에선 47초 만에 200으로 성공했던 같은 질문이, 압박 중에는 Traefik이 앱 응답을 못 받아 502를 반환했다. 컨테이너는 안 죽었지만 기능은 실패했다.

### k6 수치 정정

같은 구간 k6(10VU, 10m30s) 최종 집계는 `http_req_failed 62.57%`였으나, 이는 **축 A의 k6가 끝나기 전에 축 B(`docker compose stop`)를 시작해버려** 후반부가 "서비스 완전 정지" 구간과 겹쳐 오염된 값이었다. 원본 JSON을 축 A 실제 실행 구간(11:56:00~12:02:00 UTC)으로 필터링해 재계산했다.

```
axis A window requests: 550
failed: 10
fail rate: 1.82%
p95 duration: 71.6ms
max duration: 60000.9ms   (요청 하나가 60초 타임아웃에 정확히 걸림)
```

**축 A의 공식 수치는 1.82%(10/550), p95 71.6ms다.**

---

## 축 B: 90%는 실제로는 오버섭스크립션이 아니었다

`docker compose stop` → `stress-ng --vm 4 --vm-bytes 90% --timeout 300s --no-oom-adjust` → `docker compose up -d`.

```
stress-ng: info:  [7856] vm: using 1.20G per stressor instance (total 4.81G of 5.27G available memory)
stress-ng: info:  [7851] vm             28184029    300.00   1120.17     76.44     93945.90       23553.32
stress-ng: info:  [7851] successful run completed in 5 mins
```

4.81G 요청 vs 5.27G 가용 — OOM 없이 300초 전체를 완주했다. 서비스를 완전히 내리면 그만큼 메모리가 비어, "총 메모리의 90%"가 실제로는 여유 있는 값이 되기 때문이다. 재기동 후 8개 컨테이너 전부 정상(healthy) 확인. 이 축을 진짜 한계 테스트로 만들려면 95%+ 나 명시적 GB 상향이 필요하다.

---

## 축 C: 400VU + AI 채팅 동시 실행

캐시 초기화 후 400VU 부하 도중 T0+150초 지점에 `/chat` 벡터 질의를 같이 쐈다.

```
$ cat chat.log
HTTP 200, 58.247143s
```

```
app-app-1   2.644GiB / 7.759GiB   285.19%   ← 채팅 응답 직후, CPU 급증
app-app-1   2.647GiB / 7.759GiB   242.93%
app-app-1   2.647GiB / 7.759GiB   1.85%     ← 이후 정상 유휴로 복귀, 메모리는 유지
```

```
█ THRESHOLDS
  http_req_duration: ✓ 'p(95)<800' p(95)=52.43ms
  http_req_failed:   ✓ 'rate<0.01' rate=0.00%

█ TOTAL RESULTS
  checks_succeeded: 100.00% 61475 out of 61475
  http_req_duration: avg=18.08ms p(90)=36.23ms p(95)=52.43ms max=2.8s
  http_reqs: 61475 (185.38/s)
```

```
평균 (81샘플, ~6.75분): avg used=2118MB  avg available=5826MB
AnonHugePages: 305152 kB → 700416 kB
최종 free -m: used 2435MB / available 5509MB / buff·cache 2087MB
```

에러율 0%, p95 52.43ms — **AI 채팅의 2.6GB 스파이크가 겹쳐도 일반 API 부하는 전혀 흔들리지 않았다.** 이는 축 A(호스트 레벨 압박까지 겹쳤을 때 502 실패)와 뚜렷이 대비된다: 위험은 AI 채팅 스파이크 단독이 아니라, **여러 메모리 소비원이 동시에 겹칠 때** 생긴다.

---

## 실행 중 발견한 사고와 교정

1. **leaky-batch 재시작 정책 누락**: VM 리사이즈(stop/start) 후 컨테이너가 안 살아남음 → `--restart unless-stopped` 추가로 해결.
2. **축 순서 겹침**: 축 A의 k6 job(10분30초)이 끝나기 전에 축 B를 시작해 후반부 데이터 오염(62.57%로 잘못 집계) → 원본 JSON을 실제 시간대로 필터링해 정정(1.82%). **이후 축 실행 전에는 이전 축의 k6 job이 완전히 끝났는지 반드시 확인한다.**

---

## 종합 표

| 축 | 핵심 결과 |
|---|---|
| A (3G+2G 호스트 + 1G 컨테이너 leak + AI 채팅 T0+90s) | OOM 3회(전부 stress-ng-vm 희생, 단 app 자신의 python3.12가 2회 직접 트리거), 가용메모리 최저 **135MB**, `/chat` **502 실패**(18.5s), k6 **1.82%**(정정값), p95 71.6ms |
| B (90%, 서비스 완전 정지) | 4.81G vs 5.27G 가용 — **OOM 없이 완주** |
| C (400VU + AI 채팅 T0+150s) | 에러 **0%**, p95 52.43ms, 평균 used 2118MB, `/chat` **200 성공**(58.2s), app-app-1 2.647GiB까지 성장해도 API 무피해 |

## After 실행 시 유의점

- 반드시 같은 `e2-custom-4-8192`(8GB) 위에서 실행해야 비교가 유효하다.
- AI 채팅 트리거는 동일 타이밍(A: T0+90s, C: T0+150s)으로 재현한다.
- k6-loadgen은 preemptible VM이므로 실행 전 상태를 먼저 확인한다.
- 각 축의 k6 job이 완전히 끝났는지 확인한 뒤 다음 축을 시작한다.
- 축 B는 필요시 95%+ 또는 명시적 GB 상향으로 재설계를 검토한다.
