# 09. 안정성 테스트 계획: 최적화 적용 전후 비교

**일정**: 2026-07-16  
**분류**: `stability` — 커널 튜닝 / OOM 대응 / 메모리 안정성  
**요약**: 08번 문서의 개선안 적용 전후를 세 가지 축으로 비교한다. ① 실 서비스 중 발생할 수 있는 메모리 고갈 시나리오를 재현해 서비스가 어떻게 반응하는지, ② 서버에 직접 메모리 스트레스를 걸었을 때 얼마나 버티는지, ③ 같은 100VU 부하를 줬을 때 메모리를 얼마나 덜 쓰는지. 세 축 모두 Before(미적용) → 적용 → After(적용 후) 구조로 수치를 남긴다.

---

## 배경: 왜 세 가지 축인가

k6로 재는 성능 지표(지연, 처리량)는 평상시 부하에서는 이미 충분한 수준에 올라와 있다. 08번 문서에서 정리한 개선안(zram, THP 전환, 컨테이너 리소스 제한, swappiness, earlyoom 등)은 평시에는 지표가 전혀 달라지지 않고, **메모리가 한계에 몰릴 때**에만 차이를 만든다. 따라서 아래 세 가지를 별도로 재야 개선 효과가 드러난다.

| 축 | 핵심 질문 | 방법 |
|---|---|---|
| A. 실 서비스 OOM 재현 | 서비스가 살아있는 채로 메모리가 꽉 차면 어떻게 되는가? | 서비스를 띄운 채로 메모리를 채워가며 서비스 응답을 관찰 |
| B. 직접 메모리 스트레스 | 서버가 메모리 폭주를 얼마나 버티는가? | `stress-ng`<sup class="fnref"><a href="#fn-stressng">[s1]</a></sup>로 한계까지 밀어붙여 OOM 발생 시점과 복구 여부 측정 |
| C. 100VU 부하 메모리 절약 | 동일 부하에서 메모리 사용량이 줄었는가? | `load.js`를 100VU로 고정해 Before/After 메모리 추이 비교<sup class="fnref"><a href="#fn-k6mem">[s2]</a></sup> |

---

## 사전 준비: 설정 토글 스크립트

세 축 모두 Before/After 비교가 핵심이므로, 세팅을 오갈 수 있는 스크립트가 먼저 있어야 한다.

### 스크립트 세 명령

```bash
sudo ./toggle.sh snapshot             # 현재 커널 파라미터 값을 snapshot.json에 저장
sudo ./toggle.sh apply                # 개선값으로 일괄 적용
sudo ./toggle.sh revert               # snapshot.json 값으로 되돌리기
sudo ./toggle.sh revert --only zram   # 특정 항목 하나만 되돌리기
```

### 토글 대상 항목 (11개)

| 항목 | Before(현재값) | After(개선값) | 비고 |
|---|---|---|---|
| zram | 없음 | **6GB** (lz4 압축, 개정) | Fedora 33 기본 스왑으로 채택<sup class="fnref"><a href="#fn-zram">[s3]</a></sup>. 8GB 리사이즈 이후 실측한 최악 상황(가용메모리 135MB, 11번 문서)을 감안해 4GB→6GB로 상향 |
| `vm.swappiness` | 60 | **60, 변경 없음 (개정)** | 원안은 10으로 낮추는 것이었으나, zram은 진짜 디스크가 아니라 압축된 RAM이라 스왑 비용이 싸다. [s4]가 인용하는 실무 사례("메모리 누수 방지가 성능보다 중요하면 오히려 swappiness를 높이는 게 유효")를 따라 기본값(60)을 유지하기로 했다. Before와 값이 같아 이 항목은 toggle.sh apply가 사실상 아무것도 바꾸지 않는다 |
| `vm.min_free_kbytes` | 65536 | 131072 | 대용량 메모리 서버 표준<sup class="fnref"><a href="#fn-minfree">[s4]</a></sup> |
| THP 모드 | always | never | Redis·MongoDB·Oracle 공식 필수<sup class="fnref"><a href="#fn-thp">[s5]</a></sup> |
| `vm.dirty_ratio` | 20 | 10 | 즉시 |
| `vm.dirty_background_ratio` | 10 | 5 | 즉시 |
| `vm.vfs_cache_pressure` | 100 | 50 | 즉시 |
| `net.ipv4.tcp_max_syn_backlog` | 1024 | 8192 | jirak.net 실무 정리 참고<sup class="fnref"><a href="#fn-network">[s6]</a></sup> |
| `net.core.rmem_max` / `wmem_max` | 208KB | 4MB | 즉시 |
| 컨테이너 mem/cpu 제한 | 없음 | app 4GB/**4CPU (개정, 원안 2CPU)** | 카카오페이 CPU 8.8%/메모리 4.7% 절감 사례<sup class="fnref"><a href="#fn-container">[s7]</a></sup>. After 축 C 400VU 테스트에서 2CPU 제한이 uvicorn 4워커와 충돌해 CPU 쓰로틀링(p95 52ms→584ms, 실패율 0%→4.7%)을 유발함을 실측으로 확인, 4CPU로 상향 |
| 컨테이너 ulimit nofile | 기본값 | 65536 | compose 재기동 필요 |

> **컨테이너 재기동 항목 처리**: `apply`/`revert` 마지막 단계에서 compose 파일을 수정하고 `docker compose up -d`로 한 번만 재기동한다. 재기동 후 컨테이너 상태가 안정되길 기다리는 30초 대기를 스크립트 안에 포함해, "재기동 흔들림"이 측정값에 섞이지 않게 한다.
> 
> Docker 공식 문서는 "메모리 제한 없이 실행하면 호스트 전체 메모리를 점유할 수 있다"고 명시하며 컨테이너 리소스 제한을 강력히 권장한다<sup class="fnref"><a href="#fn-container">[s7]</a></sup>.

---

## 축 A. 실 서비스 OOM 재현

### 목적

실제 서비스가 떠 있는 상태에서 외부 메모리 압박을 가해 OOM이 발생할 때 서비스가 어떻게 반응하는지 본다. "완전히 죽는가, 느려지다가 살아나는가, 죽더라도 자동으로 재시작되는가"가 핵심이다.

### 방법

```bash
# 터미널 1: k6로 서비스에 가벼운 상시 부하를 걸어 살아있음을 확인
k6 run -e BASE_URL=https://<prod-url> \
       -e MAX_VUS=10 -e DURATION=10m \
       load.js

# 터미널 2: 호스트에서 메모리를 단계적으로 채운다
# --vm 1: 워커 1개, --vm-bytes: 점유 크기, --timeout: 지속
stress-ng --vm 1 --vm-bytes 6G  --timeout 120s &   # 단계 1: 가용 메모리의 ~45% 점유
sleep 30
stress-ng --vm 1 --vm-bytes 10G --timeout 120s &   # 단계 2: ~75% 점유
sleep 30
stress-ng --vm 1 --vm-bytes 13G --timeout 120s &   # 단계 3: ~95% 점유 (OOM 경계)
```

`stress-ng`는 VM 호스트 레벨에서 메모리를 점유한다. 이 방식이 컨테이너 내부 점유와 다른 점은 **실 서비스 트래픽이 유지되는 채로** 호스트 메모리가 줄어드는 상황을 시뮬레이션한다는 것이다. 실제로 메모리 leak이 있는 다른 컨테이너나 배치 작업이 동시에 돌 때의 상황에 가장 가깝다.

### 관찰 지표

| 관찰 항목 | 수집 방법 |
|---|---|
| 서비스 응답 유지 여부 | k6 `http_req_failed` 율 (터미널 1 결과) |
| k6 p95 지연 추이 | 메모리 단계별 지연 변화 |
| OOM killer 개입 여부 | `dmesg -T \| grep -i "oom killer"` |
| 죽은 프로세스/컨테이너 | `dmesg -T \| grep "Killed process"` |
| earlyoom/systemd-oomd 선제 개입 | `journalctl -u earlyoom -n 50` |
| 압박 해제 후 자동 회복 여부 | stress-ng 종료 뒤 k6 지연 정상화 구간 |
| 컨테이너 상태 | `docker ps --format "table {{.Names}}\t{{.Status}}"` |

### Before / After 판정 기준

| 조건 | Before(미적용) 예상 | After(적용 후) 목표 |
|---|---|---|
| OOM 개입 주체 | 커널 OOM killer (예측 불가) | earlyoom<sup class="fnref"><a href="#fn-earlyoom">[s8]</a></sup>이 먼저 선제 종료 |
| 죽는 대상 | 임의 프로세스 (app일 수도 있음) | app 컨테이너가 아닌 쪽이 먼저 희생 |
| 서비스 응답 유지 | 단계 3에서 `http_req_failed` > 10% 예상 | 단계 3에서도 `http_req_failed` < 5% |
| 압박 해제 후 회복 | 수동 재시작 필요할 수 있음 | 60초 안에 자동 정상화 |

> **판정 기준에 수치를 넣은 이유**: 결과를 보고 나서 유리하게 해석하는 것을 막기 위해 테스트 전에 미리 확정한다.

---

## 축 B. 직접 메모리 스트레스 — 한계 내구성 테스트

### 목적

서비스 없이 순수하게 서버가 메모리 폭주를 얼마나 버티는지, 한계를 넘었을 때 얼마나 빨리 복구되는지를 측정한다. zram과 swappiness 개선의 효과가 가장 직접적으로 드러나는 축이다.

### 방법

서비스를 일시 중지하고 메모리를 최대한으로 밀어붙인다.

```bash
# 서비스 일시 중지 (측정값에 서비스 메모리가 섞이지 않게)
docker compose -f /path/to/compose.yml stop

# Before: zram 없는 상태에서 한계 측정
stress-ng --vm 4 --vm-bytes 90% --timeout 300s \
          --metrics-brief --log-file stress-before.log

# After: zram + swappiness=10 적용 후 동일 조건
stress-ng --vm 4 --vm-bytes 90% --timeout 300s \
          --metrics-brief --log-file stress-after.log

# 서비스 복구
docker compose -f /path/to/compose.yml start
```

`--vm 4 --vm-bytes 90%`는 4개 워커가 각각 총 메모리의 90%를 채우려고 경쟁하므로 실질적으로 OOM killer가 개입하는 수준까지 민다. `--timeout 300s`는 5분 안에 OOM이 발생하지 않으면 zram이 압축을 통해 실제 가용 메모리를 늘려준 것으로 해석한다.

모니터링은 별도 스크립트로 주기적으로 파일에 기록한다.

```bash
# monitor.sh: 5초마다 메모리·스왑·zram 상태를 로그로 남기는 루프
while true; do
  echo "=== $(date '+%H:%M:%S') ===" >> mem-monitor.log
  free -m >> mem-monitor.log
  [ -b /dev/zram0 ] && zramctl >> mem-monitor.log
  sleep 5
done
```

### 관찰 지표

| 지표 | 수집 명령 | 수집 주기 |
|---|---|---|
| 메모리 사용률 (%) | `free -m` | 5초 간격 |
| zram 압축 통계 | `zramctl` / `cat /sys/block/zram0/stat` | 10초 간격 |
| 스왑 사용량 | `vmstat -s \| grep swap` | 5초 간격 |
| OOM 발생 시점 | `dmesg -T \| grep -E "oom\|Killed"` | 이벤트 발생 시 |
| stress-ng 워커 처리량 | `stress-before.log` vs `stress-after.log` | 종료 후 비교 |

### Before / After 판정 기준

| 지표 | Before 예상 | After 목표 |
|---|---|---|
| OOM 발생까지 걸리는 시간 | 60~120초 안에 OOM | 300초 종료까지 OOM 미발생 (zram 덕) |
| 최대 스왑 사용량 | 0 (스왑 없음) | zram 압축으로 최소 2GB 가상 스왑 확보 |
| OOM 이후 복구 시간 | stress-ng 종료 후 60초 이상 | 30초 이내 메모리 정상화 |
| stress-ng 워커 처리량 | OOM으로 중단 | 5분 지속 후 정상 완료 |

---

## 축 C. 100VU 동일 부하 — 메모리 절약량 비교

### 목적

튜닝이 성능(지연·처리량)을 해치지 않으면서 메모리 사용량을 줄이는지를 본다. "같은 일을 더 적은 메모리로 할 수 있는가"가 핵심 질문이다. THP → never 전환, vfs_cache_pressure 조정, dirty_ratio 하향의 효과가 이 축에서 드러난다.

### 방법

`load.js`를 100VU, 5분 고정으로 실행하고 그 동안의 메모리 추이를 기록한다. Before와 After에서 완전히 동일한 조건으로 실행한다.

```bash
# 실행 전 캐시 초기화 (캐시 상태를 동일하게 맞추기 위해)
sync && echo 3 | sudo tee /proc/sys/vm/drop_caches

# k6 부하 실행 (Before / After 동일)
k6 run \
  -e BASE_URL=https://<prod-url> \
  -e MAX_VUS=100 \
  -e DURATION=5m \
  --out json=k6-output-before.json \
  load.js
# After에서는 k6-output-after.json으로 바꿔 실행

# 메모리 모니터링 (별도 터미널, k6 실행과 동시에)
while true; do
  echo "$(date '+%H:%M:%S') $(free -m | awk 'NR==2{print $3"MB used, "$7"MB available"}')" \
    >> mem-100vu-before.log
  sleep 5
done
# After에서는 mem-100vu-after.log로 바꿔 실행
```

### 관찰 지표

| 지표 | 측정 방법 | 비교 방식 |
|---|---|---|
| RSS 총합 (컨테이너 전체) | `docker stats --no-stream --format "{{.Names}} {{.MemUsage}}"` | 5분 평균 |
| 가용 메모리 (available) | `free -m` → `available` 컬럼 | 5분 평균 및 최솟값 |
| 페이지 캐시 사용량 | `free -m` → `buff/cache` 컬럼 | 5분 평균 |
| k6 p95 지연 | k6 결과 JSON | Before와 동등한지 확인 (퇴보 없는지) |
| k6 에러율 | k6 `http_req_failed` | 1% 미만 유지 확인 |
| THP 활성 페이지 수 | `cat /proc/meminfo \| grep AnonHugePages` | Before에서만 > 0 이어야 |

### Before / After 판정 기준

| 지표 | Before 예상 | After 목표 | 개선 판정 |
|---|---|---|---|
| 5분 평균 메모리 사용량 | 측정값 (기준선) | 기준선 대비 **10% 이상 감소** | ✓ 절약 |
| 5분 최소 가용 메모리 | 측정값 (기준선) | 기준선 대비 **500MB 이상 증가** | ✓ 여유 확보 |
| AnonHugePages | > 0 (THP 활성) | 0 (THP never) | ✓ THP 제거 확인 |
| k6 p95 지연 | 측정값 (기준선) | 기준선 ±10% 이내 | ✓ 성능 퇴보 없음 |
| k6 에러율 | < 1% | < 1% | ✓ 동등 |

> **10%, 500MB 기준 근거**: 16GB 서버에서 THP와 vfs_cache_pressure 조정만으로 10% 절약은 보수적이다. THP 거대 페이지(2MB × N개)와 파일 캐시 과잉 점유 해소가 주된 요인이 될 것으로 예상한다. 만약 이 기준에 못 미치면, 개선안의 효과가 이 규모 서버에서는 미미하다는 근거로 문서에 남긴다.

---

## 실행 순서

```
0. VM 디스크 스냅샷 (gcloud 콘솔에서, 안전망)
   ↓
1. toggle.sh snapshot (현재 커널값 확정 저장)
   ↓
2. BEFORE 실행 — 세 축을 순서대로
   2-A. 실 서비스 OOM 재현 (load.js 10VU + stress-ng 단계적 압박)
   2-B. 직접 메모리 스트레스 (서비스 중지 → stress-ng → 서비스 재기동)
   2-C. 100VU 부하 메모리 측정 (캐시 초기화 → k6 100VU 5분 → 메모리 기록)
   ↓
3. toggle.sh apply (11개 항목 적용, compose 재기동 포함)
   → 재기동 후 5분 대기 (안정화)
   ↓
4. AFTER 실행 — Before와 동일 조건으로
   4-A. 실 서비스 OOM 재현
   4-B. 직접 메모리 스트레스
   4-C. 100VU 부하 메모리 측정
   ↓
5. 비교 및 기록 (10번 문서)
   → 축별로 Before/After 수치 나란히 정리
   → 판정 기준 대비 개선 여부 판단
   → 미달 항목은 toggle.sh revert --only <항목>으로 개별 되돌리기
```

### 실행 조건 고정 (재현성)

| 조건 | 값 |
|---|---|
| 실행 시간대 | 새벽 1~4시 (KST, 트래픽 최저) |
| stress-ng 단계별 점유 크기 | 6G / 10G / 13G (고정) |
| stress-ng 단계별 유지 시간 | 각 120초 (고정) |
| stress-ng 직접 스트레스 | `--vm 4 --vm-bytes 90% --timeout 300s` |
| k6 VU | 100 (고정) |
| k6 DURATION | 5m (고정) |
| 캐시 초기화 | 매 k6 실행 전 `drop_caches=3` |
| 각 축 사이 대기 | 10분 (서버 상태 안정화) |

---

## 안전 장치

이 서버는 실제로 서비스 중이므로 한계 테스트는 부담이다. 아래를 반드시 지킨다.

1. **VM 디스크 스냅샷 확인**: 시작 전에 스냅샷이 성공했는지 gcloud 콘솔에서 확인. 이것이 없으면 테스트를 시작하지 않는다.
2. **되돌리기 경로 사전 검증**: 본격 실행 전에 `swappiness` 하나만 apply → revert 해서 스크립트가 동작하는지 확인한다.
3. **컨테이너 폭주·강제 OOM 시나리오**: 실행 직전 별도 확인받고 진행.
4. **결과가 예상과 다르면 즉시 중단**: OOM 이후 컨테이너가 자동 복구되지 않으면 스크립트 revert → 안 되면 VM 디스크 스냅샷 복구.
5. **이 문서는 계획까지**: 실제 스크립트 작성과 시나리오 실행은 이 계획 검토 이후 별도 단계로 진행한다.

---

<hr>

## 예상 개선량: 우리 서버 기준

> 이 섹션은 테스트 전에 미리 세운 **사전 예측**이다. 각 수치는 우리 서버의 실측값(16GB RAM, 평시 1.7GB 사용, 10개 컨테이너, Redis 포함)과 원문 출처를 조합해 도출했다. 테스트 후 실제값과 비교해 얼마나 맞았는지를 다음 문서에 기록한다.

### 서버 현재 상태 요약 (Before 기준선)

| 항목 | 실측값 |
|---|---|
| 총 메모리 | 15Gi (실측) |
| 평시 사용 | 1.7GB (약 11%) |
| 평시 가용 | 13GB |
| 스왑 | **0B** (전혀 없음) |
| THP 모드 | **always** (최악의 설정) |
| swappiness | 60 (기본값, 스왑이 없어 현재는 의미 없음) |
| 컨테이너 메모리 제한 | **없음** (10개 컨테이너 전부 무제한) |
| earlyoom | **미설치** |
| 100VU 부하 시 메모리 | 미측정 (테스트 전 기준선 수립 필요) |

---

### 항목별 예상 개선량

#### 1. zram 4GB (lz4) — 스왑 여유 확보

> **개정**: 아래 예측은 16GB 원안 기준으로 작성됐다. 실제 적용값은 8GB 리사이즈 이후 6GB로 상향했고, swappiness도 10이 아닌 60(변경 없음)으로 개정했다. 근거는 34~48줄 표와 11번 문서 참고.

**근거**: Fedora 33 릴리즈 노트 (Changes/SwapOnZRAM) — "lz4 압축 알고리즘으로 압축률 2:1 이상이 일반적이며, zram 장치 크기를 RAM의 50%로 설정하면 실제 스왑 가능 용량은 1GB zram당 약 1.5~2GB 효과". 같은 문서에서 "OOM kill까지 걸리는 시간을 단축하고 스왑 스래싱 없이 메모리 압박을 완충"한다고 명시.

| 지표 | Before 예상 | After 예상 | 근거 |
|---|---|---|---|
| 유효 스왑 가용량 | 0MB | **6~8GB** (4GB zram × 압축률 1.5~2:1) | Fedora 릴리즈 노트 |
| 90% 메모리 압박에서 OOM 발생까지 | 60~90초 | **300초 이상 (OOM 미발생)** | stress-ng 300s 기준 |
| OOM kill 빈도 (압박 시) | 높음 | **대폭 감소** | "reduces OOM kill frequency" |

> **우리 서버 적용 시**: 현재 스왑이 0B인 상태에서 갑작스러운 메모리 급증은 즉시 OOM을 유발한다. 4GB zram이면 실질적으로 6~8GB의 완충재가 생겨, 단기 급증(예: 배치 처리 중 메모리 spike)은 OOM 없이 흡수된다.

---

#### 2. THP `always` → `never` — p99 지연 스파이크 제거

**근거**: Redis 공식 문서 "Latency induced by transparent huge pages" 섹션 원문 인용:
> *"Unfortunately when a Linux kernel has transparent huge pages enabled, Redis incurs to a big latency penalty after the fork call is used in order to persist on disk. In a busy instance, a few event loops runs will cause commands to target a few thousand of pages, causing the copy on write of almost the whole process memory. This will result in **big latency and big memory usage**."*
> — redis.io, Diagnosing latency issues (2026-07-15 갱신)

우리 스택에 Redis가 포함되어 있고(`redis-exporter`가 있다는 것은 Redis 인스턴스가 존재한다는 의미), PostgreSQL도 `fork()` 기반 checkpoint를 사용한다.

| 지표 | Before 예상 | After 예상 | 근거 |
|---|---|---|---|
| Redis fork 시 p99 latency spike | 수초 발생 가능 | **수백ms 이하로 억제** | Redis 공식 문서 |
| AnonHugePages (메모리 낭비) | > 0 (2MB 페이지 단위 낭비) | **0** | `/proc/meminfo` |
| 100VU 부하 시 메모리 절약 | 기준선 | **5~15% 감소 예상** | THP 내부 단편화 해소 |
| khugepaged CPU 점유 | 간헐적 spike | **0%** | THP 비활성화로 완전 제거 |

> **우리 서버 적용 시**: 현재 THP=always인데, 이 상태에서 Redis가 AOF rewrite나 BGSAVE를 하면 2MB 단위 CoW가 발생해 메모리 사용량이 일시 급증한다. `never`로 바꾸면 이 급증이 사라지고, 동시에 khugepaged 백그라운드 작업이 없어져 CPU spike도 해소된다.

---

#### 3. earlyoom 설치 — OOM 개입 타이밍 개선

**근거**: earlyoom GitHub 문서 — "earlyoom checks memory and swap levels every second. It kills the process with the highest badness score if memory goes below 10% **and** swap goes below 10%. Unlike the kernel OOM killer, earlyoom acts while the system is **still responsive**."

| 지표 | Before (커널 OOM killer) | After (earlyoom) | 근거 |
|---|---|---|---|
| 개입 시점 | 메모리 **~0%** (시스템 이미 frozen) | 메모리 **~10%** (≈1.5GB 잔여 시) | earlyoom README |
| 개입까지 시스템 반응성 | 수십초~수분 freeze | **유지됨** | "while still responsive" |
| 종료 신호 | SIGKILL (즉각 강제 종료) | **SIGTERM → 10초 후 SIGKILL** | 앱이 정리할 시간 확보 |
| 종료 대상 예측 가능성 | 커널 점수 기반 (불투명) | `--prefer` 옵션으로 **명시적 지정 가능** | earlyoom README |

> **우리 서버 적용 시**: 현재는 메모리가 고갈되면 커널 OOM killer가 임의로 프로세스를 죽인다. earlyoom을 설치하면 `--prefer '^(stress|python)' --avoid '^(postgres|redis)'` 식으로 보호 대상을 명시할 수 있다.

---

#### 4. 컨테이너 메모리 제한 (app: 4GB) — 격리 보장

**근거**: Docker 공식 문서 (Resource Constraints) — *"By default, a container has no resource constraints and can use as much of a given resource as the host's kernel scheduler allows. [...] On Linux hosts, if the kernel detects that there is not enough memory to perform important system functions, it throws an **OOMKill** error and starts killing processes to free up memory."*

| 지표 | Before (제한 없음) | After (app: 4GB 상한) | 근거 |
|---|---|---|---|
| 한 컨테이너 폭주 시 | 전체 16GB 점유 가능 → 호스트 OOM | app 컨테이너만 4GB 내에서 제한 | Docker 공식 문서 |
| 다른 컨테이너 영향 | postgres, grafana 등 함께 죽을 수 있음 | **격리 보장** | cgroup v2 |
| OOM kill 대상 | 호스트 전체에서 임의 선택 | **app 컨테이너 내부로 한정** | cgroup 메모리 한도 |

> **우리 서버의 10개 컨테이너 상황**: app이 무제한으로 메모리를 쓰다 고갈되면 postgres가 죽을 수 있다. 제한 후에는 app이 4GB를 다 써도 postgres(~1~2GB)는 안전하다.

---

#### 5. 100VU 부하 시 종합 메모리 절약 예측

100VU 동일 부하에서 세 가지 요인의 결합 효과:

| 요인 | 예상 절약량 | 메커니즘 |
|---|---|---|
| THP → never | **300~800MB** | 2MB 페이지 단편화 해소 + CoW 급증 방지 |
| vfs_cache_pressure 100→50 | **100~300MB** | 파일 메타데이터 캐시 과잉 점유 완화 |
| swappiness 60→10 | 직접 절약 없음 | 부하 중 불필요한 페이지 아웃 방지 (지연 영향) |
| **합계 예상** | **400MB~1.1GB 절약** | |

> **판정 기준과의 관계**: 앞서 판정 기준으로 "500MB 이상 가용 메모리 증가"를 설정했다. 위 예측 범위의 중간값(750MB)이 이 기준을 충족한다. 단, THP 절약은 Python/Postgres 워크로드에서 실제로 얼마나 나오느냐에 달려 있다 — 이것이 이 테스트를 실행해야 하는 이유다.

---

#### 6. 안정성 개선 종합 요약

| 시나리오 | Before 예상 동작 | After 예상 동작 | 개선 방향 |
|---|---|---|---|
| 메모리 13G → 15G (90%) | OOM killer 즉각 개입, 임의 프로세스 종료 | earlyoom이 10% 도달 시 선제 종료, app 보호 | **예측 가능성↑** |
| 메모리 15G (100%, 고갈) | 시스템 freeze → 커널 panic 가능 | zram 6~8GB 완충 → OOM까지 시간 확보 | **내구성↑** |
| Redis fork (BGSAVE 등) | p99 spike 수초 | p99 spike 제거 (THP 해소) | **지연 안정성↑** |
| app 컨테이너 메모리 leak | 전체 서비스 영향 | app 컨테이너 내에서 격리 종료 | **격리성↑** |
| 100VU 부하 메모리 | 기준선 | 400MB~1.1GB 절약 | **효율↑** |

> **한계**: 위 수치는 사전 예측이며, 특히 THP 절약량은 Python/Postgres 워크로드의 실제 메모리 접근 패턴에 크게 의존한다. After 테스트에서 예측과 크게 다른 값이 나오면, 그 차이의 원인 분석이 이 프로젝트의 가장 가치 있는 학습이 된다.

---

<hr>


## 실무 근거 참고문헌

이 문서에서 다루는 기법들은 단순히 이론 상의 권고가 아니라, 국내외 현업에서 실제로 적용되고 있는 표준 기법임을 아래 자료들로 확인했다.

<ol class="footnotes" id="stability-refs">
<li id="fn-stressng"><b>[s1] stress-ng 안정성 테스트 표준 도구</b> — Linux Foundation 공식 교육자료 및 harness.io DevOps 플랫폼에서 Before/After 비교 절차로 권장. Ubuntu 공식 패키지(<code>apt install stress-ng</code>)로 배포됨. <a href="https://github.com/ColinIanKing/stress-ng" target="_blank">GitHub: ColinIanKing/stress-ng</a></li>
<li id="fn-k6mem"><b>[s2] k6 + 메모리 모니터링 Before/After 비교</b> — Grafana(k6 개발사) 공식 문서에서 "부하 중 대상 서버 리소스를 별도 모니터링할 것"을 권장. 국내 f-lab.kr 교육자료에서 Prometheus + Grafana + k6 조합으로 Before/After 비교 방법론을 교육 커리큘럼으로 채택. <a href="https://grafana.com/docs/k6/latest/results-output/real-time/" target="_blank">k6 공식 문서: Real-time output</a></li>
<li id="fn-zram"><b>[s3] zram — Fedora/Ubuntu 공식 채택</b> — Fedora 33(2020)부터 zram을 기본 스왑 장치로 채택. Ubuntu는 <code>systemd-zram-generator</code>를 공식 패키지로 제공. "RAM은 부족하지만 디스크 I/O 병목은 피하고 싶을 때" 가장 효과적인 패턴. 국내에서도 삼성 기술블로그가 스와핑(ZRAM 포함)과 OOM Killer 두 메모리 회수 메커니즘 모두 디바이스 응답 지연을 유발한다는 관찰 결과를 공개하며 기존 메모리 관리 방식의 재검토를 제안했고, 리눅스 커널 전문 블로그 MINZKN은 zram을 이용한 SWAP 확보 절차를 실무 기준으로 정리해 공유하고 있다. <a href="https://fedoraproject.org/wiki/Changes/SwapOnZRAM" target="_blank">Fedora: Changes/SwapOnZRAM</a> · <a href="https://techblog.samsung.com/blog/article/5" target="_blank">Samsung Tech Blog: Swapping과 OOMK가 응답성에 미치는 영향</a> · <a href="https://www.minzkn.com/moniwiki/wiki.php/swap_space_using_ZRAM" target="_blank">MINZKN: ZRAM을 이용한 SWAP 확보 방법</a></li>
<li id="fn-swappiness"><b>[s4] vm.swappiness / vm.min_free_kbytes 튜닝</b> — 국내 인프라 엔지니어 블로그 vlog.tion.co.kr은 "swappiness=0이면 RAM 우선, 100이면 스왑 우선"이라는 통념이 실험적으로는 맞지 않다고 반박한다. 실제로는 전체 메모리 대비 사용 비율에 따라 스왑 빈도가 좌우되며, 메모리 누수 방지가 성능보다 중요한 상황에서는 오히려 swappiness를 높이고 vfs_cache_pressure를 크게 올려 캐시를 빠르게 반환시키는 편이 유효했다는 실무 사례도 함께 소개한다. 즉 특정 권장값을 그대로 맹신하기보다 워크로드별 실측을 기반으로 값을 정해야 한다는 것이 이 국내 실무 관찰의 요지다. Linux Kernel Documentation에서는 고메모리 서버에서 min_free_kbytes 상향을 권장한다. <a href="https://www.kernel.org/doc/html/latest/admin-guide/sysctl/vm.html" target="_blank">Linux Kernel Docs: sysctl/vm</a> · <a href="https://vlog.tion.co.kr/swappiness-%EC%84%A4%EC%A0%95-%EC%9E%98%EB%AA%BB%EB%90%9C-%EC%83%81%EC%8B%9D/" target="_blank">vlog.tion.co.kr: swappiness 설정 잘못된 상식</a></li>
<li id="fn-thp"><b>[s5] THP never — Redis·MongoDB·Oracle 공식 필수 설정</b> — Redis 공식 문서: "Redis는 THP와 호환되지 않음. 서버 시작 시 THP 활성화를 감지하면 경고 로그를 출력하고 비활성화를 강력 권고." MongoDB, Oracle DB 공식 가이드에서도 동일하게 THP 비활성화를 필수 사전 작업으로 명시. 실 운영 사례: BGSAVE 중 5초 이상 latency spike → THP 비활성화 후 0.1초 미만으로 개선. <a href="https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/" target="_blank">Redis Docs: Latency Diagnosis and Optimization</a></li>
<li id="fn-network"><b>[s6] 네트워크 커널 파라미터 튜닝</b> — 국내 인프라 엔지니어 블로그 jirak.net은 리눅스 서버의 TCP 성능을 좌우하는 커널 파라미터를 시리즈로 정리하면서, ESTABLISHED 큐를 결정하는 <code>net.core.somaxconn</code>, SYN_RECEIVED 큐를 결정하는 <code>net.ipv4.tcp_max_syn_backlog</code>, 그리고 <code>fs.file-max</code>, <code>ip_local_port_range</code> 등이 서버 동시접속 처리량에 미치는 영향을 구체적으로 설명한다. <a href="https://www.kernel.org/doc/html/latest/admin-guide/sysctl/net.html" target="_blank">Linux Kernel Docs: sysctl/net</a> · <a href="https://jirak.net/wp/%EB%A6%AC%EB%88%85%EC%8A%A4-%EC%84%9C%EB%B2%84%EC%9D%98-tcp-%EB%84%A4%ED%8A%B8%EC%9B%8C%ED%81%AC-%EC%84%B1%EB%8A%A5%EC%9D%84-%EA%B2%B0%EC%A0%95%EC%A7%93%EB%8A%94-%EC%BB%A4%EB%84%90-%ED%8C%8C-2/" target="_blank">jirak.net: 리눅스 서버의 TCP 네트워크 성능을 결정짓는 커널 파라미터 이야기 2편</a></li>
<li id="fn-container"><b>[s7] 컨테이너 메모리/CPU 제한</b> — 카카오페이 기술블로그는 "환경미화 프로젝트"에서 VPA 대신 자체 개발한 Resource Recommender로 쿠버네티스 리소스 추천값을 산출해, 테스트 환경 약 400개 서비스에 적용한 결과 CPU 8.8%, 메모리 4.7%(약 238 core / 155 GiB)를 절감했다고 밝혔다. 국내 APM 기업 WhaTap(와탭랩스)도 쿠버네티스 모니터링을 기반으로 Request/Limit을 튜닝한 실제 사례 3가지를 공개하며, 무분별한 리소스 할당이 노드 자원을 낭비시키는 과정을 구체적으로 보여준다. Docker 공식 문서 역시 "<code>--memory</code> 없이 실행하면 호스트 전체 메모리를 점유할 수 있어 반드시 제한을 권장한다"고 명시한다. <a href="https://tech.kakaopay.com/post/eco-ami/" target="_blank">카카오페이 기술블로그: 환경미화 프로젝트</a> · <a href="https://whatap.io/ko/blog/kubernetes-resource-tuing" target="_blank">WhaTap: 쿠버네티스 리소스 설정 튜닝 사례 3가지</a> · <a href="https://docs.docker.com/engine/containers/resource_constraints/" target="_blank">Docker Docs: Resource Constraints</a></li>
<li id="fn-earlyoom"><b>[s8] earlyoom — 커널 OOM Killer 선제 대응</b> — Arch Linux 공식 Wiki에 등재된 공식 지원 도구다. GitHub rfjakob/earlyoom 저장소는 3k+ 스타를 보유했고 Debian/Ubuntu/Fedora 공식 패키지로도 배포된다. "커널 OOM Killer는 시스템이 이미 멈춘 뒤에야 개입하지만 earlyoom은 임계치(기본 10%) 도달 시 선제 종료해 반응성을 유지한다." 국내 리눅스 커널 전문 블로그 MINZKN은 OOM Killer의 동작 원리를 커널 정리 자료로 공개하고 있고, 삼성 기술블로그는 OOMK(OOM Killer)가 스와핑과 함께 모바일 디바이스 응답 지연을 유발하는 두 축임을 관찰 데이터로 보여주며 기존 메모리 회수 방식의 재검토를 제안한다. <a href="https://github.com/rfjakob/earlyoom" target="_blank">GitHub: rfjakob/earlyoom</a> · <a href="https://www.minzkn.com/linuxkernel/pages/oom-killer.html" target="_blank">MINZKN: OOM 킬러(Out-Of-Memory Killer) 커널 정리</a> · <a href="https://techblog.samsung.com/blog/article/5" target="_blank">Samsung Tech Blog: Swapping과 OOMK가 응답성에 미치는 영향</a></li>
</ol>

