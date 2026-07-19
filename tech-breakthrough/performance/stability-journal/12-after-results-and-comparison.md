# 12. After 실측 결과와 Before 대비 비교

**일정**: 2026-07-16
**분류**: `stability` — 09번 계획의 `toggle.sh apply` 이후 축 A/B/C 실행 기록
**요약**: 8GB(`e2-custom-4-8192`) 환경에 11개 최적화 항목을 전부 적용한 뒤, 11번 문서와 동일한 조건(동일 스트레스 크기, 동일 AI 채팅 트리거 타이밍)으로 축 A/B/C를 재실행했다. 축 A는 뚜렷이 개선됐고 축 B는 원래도 여유가 있어 차이가 없었으며, 축 C는 1차 시도에서 컨테이너 CPU 제한(2CPU)이 오히려 성능을 악화시키는 걸 발견해 4CPU로 수정한 뒤 재실행했다.

---

## 적용한 값 (실측 확인)

`sudo toggle.sh apply` 실행 후 직접 확인한 값이다.

```
$ zramctl
NAME       ALGORITHM DISKSIZE DATA COMPR TOTAL STREAMS MOUNTPOINT
/dev/zram0 lz4             6G   4K   64B   20K       4 [SWAP]

$ sudo sysctl vm.swappiness vm.min_free_kbytes vm.dirty_ratio vm.dirty_background_ratio vm.vfs_cache_pressure net.ipv4.tcp_max_syn_backlog net.core.rmem_max net.core.wmem_max
vm.swappiness = 60
vm.min_free_kbytes = 131072
vm.dirty_ratio = 10
vm.dirty_background_ratio = 5
vm.vfs_cache_pressure = 50
net.ipv4.tcp_max_syn_backlog = 8192
net.core.rmem_max = 4194304
net.core.wmem_max = 4194304

$ cat /sys/kernel/mm/transparent_hugepage/enabled
always madvise [never]

$ docker inspect app-app-1 --format 'Memory: {{.HostConfig.Memory}}  NanoCPUs: {{.HostConfig.NanoCpus}}  Ulimits: {{.HostConfig.Ulimits}}'
Memory: 4294967296  NanoCPUs: 4000000000  Ulimits: [map[Hard:65536 Name:nofile Soft:65536]]
```

swappiness는 원안(10) 대신 60(Before와 동일, zram 환경에 맞게 개정)을, 컨테이너 CPU는 원안(2) 대신 4(아래 축 C 참고)를 적용했다.

---

## 축 A: 뚜렷한 개선

동일 파라미터(호스트 3G/240s + 2G/210s, 컨테이너 leak 1G/220s, T0+90s에 `/chat`)로 재실행.

```
=== oom / killed lines ===
(신규 이벤트 없음 — 전부 Before 때의 잔여 dmesg 기록)

=== final free -m ===
               total        used        free      shared  buff/cache   available
Mem:            7944        1791        5250           0        1306        6153
Swap:           6143        1202        4941
```

```
$ cat chat.log
HTTP 200, 96.340903s
```

k6(10VU, 10m30s) 최종 요약:
```
http_req_duration: p(95)=33.91ms
http_req_failed:   rate=0.00%
checks_succeeded: 100.00% 2911 out of 2911
```

| 지표 | Before | After |
|---|---|---|
| OOM 발생 | 3회 | **0회** |
| 가용메모리 최저 | 135MB | 118MB (더 낮았지만 swap이 최대 1355MB까지 흡수해 OOM 없이 버팀) |
| `/chat` 결과 | **502 실패** (18.5s) | **200 성공** (96.3s, 압박으로 느려졌지만 실패는 안 함) |
| k6 `http_req_failed` | 1.82%(10/550, 정정값) | **0.00%**(0/2911) |
| k6 p95 | 71.6ms | **33.91ms** |

zram이 실제로 스왑을 흡수해(최대 1355MB) OOM 킬 자체를 없앴다 — 09번 문서가 zram에 기대했던 효과("OOM kill까지 걸리는 시간 단축·스왑 스래싱 없이 압박 완충")가 정확히 실현됐다.

---

## 축 B: 원래도 여유 있어서 차이 없음

```
stress-ng: info:  vm: using 1.31G per stressor instance (total 5.26G of 5.77G available memory)
stress-ng: info:  successful run completed in 5 mins

=== final free -m ===
Mem:            7944        1746        4961           0        1642        6197
Swap:           6143          91        6052
```

Before와 마찬가지로 OOM 없이 300초 완주. 11번 문서에서 이미 확인했듯 "서비스 정지 상태의 90%"는 애초에 오버섭스크립션이 아니라, 이 축은 zram 유무와 무관하게 항상 무사고였다. 그래도 swap이 91MB만큼은 쓰였다는 게 zram이 실제로 활성 상태임을 재확인해준다.

---

## 축 C: 1차 시도에서 발견한 회귀, CPU 제한 수정 후 재실행

### 1차 시도: 컨테이너 CPU 제한(2CPU)이 회귀를 유발

```
█ THRESHOLDS
  http_req_duration: ✓ 'p(95)<800' p(95)=584.07ms
  http_req_failed:   ✗ 'rate<0.01' rate=4.70%

checks_failed: 4.70%  2638 out of 56020
```

`app-app-1` CPU 사용률(`dockerstats.log`):
```
app-app-1   2.695GiB / 4GiB   166.83%
app-app-1   2.717GiB / 4GiB   203.97%
app-app-1   2.727GiB / 4GiB   202.24%
```
메모리는 2.7GiB/4GiB로 여유 있었는데 **CPU가 195~204%(=2CPU 상한)에 계속 붙어있었다** — 09번 문서의 컨테이너 CPU 제한(2CPU, 카카오페이 사례 근거)이 이 서비스의 uvicorn 4워커 튜닝(`docker-compose.yml` 주석: "워커 수는 vCPU 수에 맞춘다")과 충돌해, 400VU+AI채팅이 겹치는 순간 CPU 쓰로틀링으로 이어졌다.

### 수정: cpus 2 → 4

```
$ sudo toggle.sh revert --only container_limits
$ sudo toggle.sh apply --only container_limits
Memory: 4294967296  NanoCPUs: 4000000000
```

09번 문서와 `scripts/toggle.sh`의 `container_limits` 값을 4CPU로 개정했다(메모리 4GB 제한은 그대로 유지 — 피크 2.7GiB로 여유 있었으므로 문제없음이 확인됨).

### 재실행 결과

```
█ THRESHOLDS
  http_req_duration: ✓ 'p(95)<800' p(95)=83.1ms
  http_req_failed:   ✓ 'rate<0.01' rate=0.00%

checks_succeeded: 100.00% 59772 out of 59772
```

| 지표 | Before | After (2CPU, 폐기) | After (4CPU, 최종) |
|---|---|---|---|
| `http_req_failed` | 0.00% | ✗ 4.70% | **0.00%** |
| p95 | 52.43ms | ✗ 584.07ms | **83.1ms** |
| `/chat` | 200 성공(58.2s) | — | 200 성공(34s) |

4CPU로 고치자 실패율은 Before와 동일하게 0%로 돌아왔고, p95는 52.43ms→83.1ms로 Before보다는 약간 높지만(메모리 4GB 제한 + 커널 튜닝의 부수 비용으로 추정) 안정성 자체는 회복됐다.

---

## 종합

| 축 | Before | After | 결론 |
|---|---|---|---|
| A | OOM 3회, `/chat` 502, k6 1.82%/71.6ms | **OOM 0회**, `/chat` 200, k6 **0.00%/33.91ms** | ✅ 뚜렷한 개선 |
| B | 무사고 완주 | 무사고 완주 (동일) | ➖ 원래도 여유 있어 차이 없음 |
| C | 0%/52.43ms | (2CPU) 4.70%/584ms → (4CPU 수정) **0%/83.1ms** | ⚠️→✅ 컨테이너 CPU 설정 수정으로 회귀 해소 |

### 이번 라운드에서 남긴 교훈
- **zram/THP/커널 sysctl 튜닝은 실제로 효과가 있었다** — 축 A의 OOM 3회→0회, `/chat` 502→200이 가장 직접적인 증거다.
- swappiness는 Before와 같은 값(60)을 유지하기로 한 개정이 맞았다 — 별도의 부작용 없이 zram과 잘 맞물렸다.
- **컨테이너 리소스 제한은 "다른 사례에서 가져온 숫자를 그대로 쓰면 안 된다"**는 걸 CPU 제한 사고로 배웠다. 이 앱의 실제 동시성 설계(uvicorn 4워커)에 맞춰 4CPU로 고쳐야 했다. 메모리 제한(4GB)은 반대로 여유가 확인돼 그대로 유지했다.
