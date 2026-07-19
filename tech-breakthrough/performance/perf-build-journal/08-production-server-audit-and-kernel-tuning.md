# 프로덕션 서버 실측: 스펙 점검과 OS/커널 튜닝 후보 조사

**일정**: 2026-07-15  
**요약**: gcloud SSH로 프로덕션 VM에 직접 접속해 CPU, 메모리, 디스크, 커널 파라미터, 컨테이너 리소스 설정을 실측했다. 스왑이 전혀 없고 컨테이너 리소스 제한도 없는 등 손대지 않은 기본값이 대부분이라는 것을 확인하고, zram과 커널 파라미터, 컨테이너 격리 세 축으로 13가지 개선 후보를 정리했다.  

## 개요

지금까지의 성능 작업은 k6로 애플리케이션 계층의 지연과 처리량을 실측하는 데 집중했다. 이 문서는 한 단계 아래로 내려가, 그 애플리케이션이 실제로 올라가 있는 VM 자체의 OS와 커널 설정을 점검한다. gcloud CLI로 인증된 세션에서 `gcloud compute ssh`로 프로덕션 VM에 직접 접속해 하드웨어 스펙과 커널 파라미터, 실행 중인 컨테이너의 리소스 설정을 있는 그대로 읽어 왔고, 그 값을 근거로 실무에서 흔히 쓰는 튜닝 후보를 정리했다. 이 문서는 조사와 권고까지만 다루며, 실제 적용은 범위 밖이다.

## 서버 사양 실측

| 항목 | 값 |
|---|---|
| 인스턴스 | GCE `app-vm`, `e2-standard-4`, asia-northeast3-a |
| CPU | Intel Xeon 2.20GHz, 4 vCPU (2코어 4스레드, 하이퍼스레딩), KVM 완전 가상화 |
| 메모리 | 16GB (실측 15Gi), 사용 1.7GB / 가용 13GB (평시 부하 기준) |
| 디스크 | `/dev/sda1` 단일 30GB, 사용률 39% (11G/30G), 별도 데이터 디스크 없음 |
| OS | Debian 13 (trixie) |
| 커널 | 6.12.95+deb13-cloud-amd64 |
| 스왑 | 0B (스왑도 zram도 전혀 없음) |
| 실행 중 컨테이너 | app, traefik, postgres-exporter, redis-exporter, node-exporter, grafana, prometheus, alloy, loki, tempo (총 10개) |

`e2-standard-4`로 이미 한 단계 올라가 있는 점이 눈에 띈다. RAG 구현기 06 문서에서 벡터 검색을 켜기 전에 권장했던 스케일업이 실제로 반영된 상태였고, 그 덕분에 평시에는 16GB 중 13GB가 여유로 남아 있었다. 문제는 이 여유가 설정으로 만들어진 여유가 아니라 아직 부하가 크지 않아서 생긴 여유라는 점이다. 아래 실측치가 그 근거다.

## 현재 커널 파라미터 실측

각 파라미터를 `/proc/sys` 경로에서 직접 읽었다. 대부분 Debian 기본값 그대로였고, 이 사실 자체가 이번 조사의 핵심 발견이다.

| 파라미터 | 실측값 | 의미 |
|---|---|---|
| `vm.swappiness` | 60 (기본값) | 스왑이 없어 현재는 의미 없는 값 |
| `vm.overcommit_memory` | 1 | 메모리 할당 요청을 항상 허용 |
| `vm.dirty_ratio` / `dirty_background_ratio` | 20 / 10 (기본값) | 더티 페이지를 디스크에 쓰기 시작하는 기준 |
| `vm.vfs_cache_pressure` | 100 (기본값) | 파일 메타데이터 캐시 회수 강도 |
| `vm.min_free_kbytes` | 65MB | 커널이 항상 남겨두는 여유 메모리 |
| THP<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> 모드 | always | 모든 익명 메모리에 무조건 거대 페이지 적용 |
| `net.core.somaxconn` | 4096 | 연결 대기열 최대 길이 |
| `net.ipv4.tcp_max_syn_backlog` | 1024 (기본값) | SYN 연결 대기열 최대 길이 |
| `net.core.rmem_max` / `wmem_max` | 208KB (기본값) | 소켓 버퍼 최대 크기 |
| I/O 스케줄러 | none | 가상 블록 디바이스용, 이미 적절 |
| CPU governor | 확인 불가 | KVM 게스트에는 cpufreq sysfs 자체가 없음 |

I/O 스케줄러가 `none`인 것과 `vm.overcommit_memory=1`인 것 두 가지는 이미 적절한 설정이다. 클라우드 VM의 가상 블록 디바이스는 하이퍼바이저 쪽에서 이미 큐잉을 처리하므로 게스트 안에서 또 스케줄링하면 오히려 손해이고, `overcommit_memory=1`은 Redis 계열 워크로드가 `fork()`로 스냅샷을 뜰 때 실패하지 않도록 하는 표준 권장값이다. 나머지는 대부분 손대지 않은 기본값이었다.

## 개선 후보

실측값을 근거로 열세 가지 후보를 정리한다. 스왑, 커널 파라미터, 네트워크, 컨테이너 격리, 안전장치 다섯 갈래로 나눴다.

<figure class="fig">
<svg viewBox="0 0 640 260" role="img" aria-label="13가지 튜닝 후보를 다섯 갈래와 우선순위로 정리한 구조도">
<rect x="15" y="30" width="145" height="60" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="87" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#b3402f">스왑/메모리</text>
<text x="87" y="68" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">zram · swappiness</text>
<text x="87" y="82" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">min_free_kbytes</text>
<rect x="170" y="30" width="145" height="60" rx="8" fill="#fbeae6" stroke="#b3402f"></rect>
<text x="242" y="52" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#b3402f">컨테이너 격리</text>
<text x="242" y="68" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">mem/cpu 상한</text>
<text x="242" y="82" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">ulimit nofile</text>
<text x="320" y="20" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#b3402f">1순위 · 평소엔 안 보이다 몰릴 때 터지는 위험</text>
<rect x="15" y="105" width="145" height="60" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="87" y="127" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">커널 메모리/캐시</text>
<text x="87" y="143" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">THP never 전환</text>
<text x="87" y="157" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">dirty_ratio 하향</text>
<rect x="170" y="105" width="145" height="60" rx="8" fill="#eef2f9" stroke="#21447c"></rect>
<text x="242" y="127" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#21447c">네트워크 스택</text>
<text x="242" y="143" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">syn_backlog 상향</text>
<text x="242" y="157" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">rmem/wmem 상향</text>
<text x="320" y="95" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#21447c">2순위 · k6에서 봤던 지연 전이·스파이크 회복과 맞닿음</text>
<rect x="15" y="180" width="300" height="55" rx="8" fill="#f7f8fa" stroke="#c9ccd3"></rect>
<text x="165" y="202" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="12" font-weight="700" fill="#1a1c20">안전장치 · vfs_cache_pressure 등 미세조정</text>
<text x="165" y="218" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="10.5" fill="#5b5e66">earlyoom, 디스크 분리 검토 포함</text>
<text x="165" y="245" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11" font-weight="700" fill="#5b5e66">3순위 · 부하를 걸어 효과를 재실측하며 하나씩 적용</text>
<rect x="335" y="30" width="290" height="205" rx="8" fill="none" stroke="#e4e6ec"></rect>
<text x="480" y="50" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">CPU governor 항목은 KVM 게스트에</text>
<text x="480" y="65" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">cpufreq 경로 자체가 없어</text>
<text x="480" y="80" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">확인 후 대상에서 제외했다.</text>
<text x="480" y="105" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">이 문서는 조사와 근거 정리까지이며,</text>
<text x="480" y="120" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">실제 적용 전후 수치 비교는</text>
<text x="480" y="135" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">별도 승인과 검증을 거친 뒤</text>
<text x="480" y="150" text-anchor="middle" font-family="Pretendard,-apple-system,'Segoe UI',sans-serif" font-size="11.5" fill="#8a8d95">이어지는 문서에서 다룬다.</text>
</svg>
<figcaption><b>그림 1.</b> 13가지 후보를 다섯 갈래와 세 우선순위로 정리했다. 실제 적용은 이 문서의 범위 밖이라, 전후 수치가 아니라 근거와 우선순위만 구조화했다.</figcaption>
</figure>

### 스왑과 메모리

1. **zram<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup> 도입.** 지금은 스왑도 zram도 전혀 없어서, 메모리가 순간적으로 모자라면 완충 없이 곧바로 OOM killer<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>가 컨테이너를 죽인다. zram은 압축된 스왑 공간을 RAM 안에 만들어, 디스크에 닿지 않고도 메모리 스파이크를 흡수한다. Fedora는 이미 30번째 릴리스부터 디스크 스왑 파티션 대신 swap-on-zram을 기본값으로 채택했고[1], RHEL 9 이상에서도 압축 인메모리 스왑의 고성능 대안으로 권장한다[2]. RAM의 25~50% 크기로 잡는 것이 일반적인 시작점이다.
2. **`vm.swappiness` 재설정.** zram을 도입하면 스왑 자체가 디스크가 아니라 압축된 RAM이라 빠르므로, 오히려 스왑을 적극적으로 쓰는 것이 유리해져 커널 문서와 실무 가이드 모두 100 안팎, 경우에 따라 그 이상의 값을 권장한다[2][3]. 반대로 zram 없이 디스크 스왑만 고려한다면 10 근처로 낮춰 스왑을 최대한 피하는 것이 정석이다[4].
3. **`vm.min_free_kbytes` 상향.** 16GB 메모리에 여유분이 65MB뿐이면, 갑자기 큰 할당 요청이 몰릴 때 커널이 여유를 확보하려고 급하게 회수 작업을 하며 지연이 튄다. 커널 공식 문서는 로그에 "page allocation failure"가 자주 보이면 이 값을 늘리라고 명시한다[5]. 256MB 안팎으로 올리면 이런 순간적인 압박 상황에서 할당 실패나 지연 스파이크를 줄일 수 있다.

### 커널 메모리/캐시 파라미터

4. **THP를 `never`로 전환.** MongoDB 공식 문서는 THP가 데이터베이스 워크로드의 비연속적 메모리 접근 패턴과 맞지 않아 성능을 떨어뜨린다며 비활성화를 권장하고[6], Redis도 THP가 켜져 있으면 지연과 과도한 메모리 사용을 유발한다고 명시적으로 경고한다[7]. `always` 상태에서는 `khugepaged`가 백그라운드에서 계속 거대 페이지로 재구성 작업을 하는데, 이 압축 작업이 예측 불가능한 시점에 지연 스파이크를 만든다.
5. **`vm.dirty_ratio`/`vm.dirty_background_ratio` 하향.** Prometheus, Loki, Tempo가 전부 이 30GB 단일 디스크에 시계열 데이터를 계속 쓰고 있다. 커널 문서와 SUSE의 튜닝 가이드 모두 이 두 값을 더티 페이지 쓰기 시점을 조절하는 핵심 손잡이로 설명하는데[5][8], 기본값(20/10)은 더티 페이지가 꽤 쌓인 뒤에야 플러시를 시작하게 두는 만큼 더 자주 작은 단위로 플러시하도록 낮추면(예: 10/5) 한 번에 몰아서 쓰는 큰 지연 스파이크를 피할 수 있다.
6. **`vm.vfs_cache_pressure` 하향.** 관측 스택이 만드는 작은 파일이 많아, 기본값 100 대신 50 근처로 낮추면 파일 메타데이터 캐시가 더 오래 유지되어 반복되는 파일 조회의 디스크 접근이 줄어든다. 다만 커널 문서는 이 값을 100보다 크게 올리는 쪽은 락 경합 때문에 오히려 손해라고 경고하므로[5], 낮추는 방향으로만 조정한다.

### 네트워크 스택

7. **`net.ipv4.tcp_max_syn_backlog` 상향.** `somaxconn`은 4096인데 SYN 백로그는 기본값 1024로 남아 있다. 두 값이 어긋나 있으면 실제 대기열 용량은 더 작은 쪽에 막힌다. 고트래픽 서버 튜닝 가이드는 연결 요청이 많은 서비스일수록 `somaxconn`과 `tcp_max_syn_backlog`를 함께 올리라고 권한다[9][10]. k6 스파이크 테스트처럼 순간적으로 연결이 몰리는 상황에서는 이 SYN 백로그부터 넘칠 수 있으므로 somaxconn과 맞춰 올리는 것이 합리적이다.
8. **`net.core.rmem_max`/`wmem_max` 상향.** 소켓 버퍼 상한이 208KB로, 동시 연결이 많고 응답 크기가 큰 API 서버치고는 작은 편이다. 고성능 네트워킹 가이드에서는 이 값을 16MB 수준까지 올리는 것을 표준 구성으로 제시한다[9][10]. 몇 MB 수준으로 올리면 처리량이 필요한 상황에서 버퍼 부족으로 인한 병목을 줄일 수 있다.

### 컨테이너 리소스 격리

9. **컨테이너별 메모리/CPU 상한 설정.** `docker inspect`로 확인한 결과 10개 컨테이너 중 어느 것도 메모리나 CPU 상한이 걸려 있지 않았다. Docker 공식 문서는 리소스 제한 없이 컨테이너를 운영하면 컨테이너 하나가 호스트 전체 자원을 소진할 수 있다고 명시하고[11][12], 지금처럼 평시 부하에서는 문제가 안 되지만 임베딩 모델 로딩이나 예상치 못한 메모리 누수가 한 컨테이너에서 터지면 그 컨테이너 하나가 VM 전체 메모리를 잠식해 API 서버를 포함한 나머지 전부를 함께 끌고 내려갈 수 있다. `mem_limit`/`cpus`를 서비스별로 명시해 격리하는 것이 표준적인 방어다.
10. **컨테이너 `ulimit`(nofile) 상향.** 앱 컨테이너에 별도 ulimit이 설정되어 있지 않아 Docker 기본값을 그대로 쓴다. 실무 가이드는 기본값 1024가 대부분의 앱에는 충분하지만 동시 접속이 많은 서버에서는 부족해진다고 지적한다[13][14]. 리버스 프록시 뒤에서 동시 연결을 많이 받는 API 서버는 열린 파일 디스크립터<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup> 수가 기본값보다 훨씬 많이 필요할 수 있어, compose 파일에 `ulimits: nofile` 항목을 명시적으로 올려두는 편이 안전하다.

### 안전장치와 디스크 위생

11. **earlyoom 또는 systemd-oomd 도입.** 조기 OOM 방어 도구가 전혀 설치되어 있지 않다. earlyoom은 1초에 10번 메모리와 스왑 사용량을 점검해 시스템이 멈추기 전에 먼저 개입하도록 설계됐고[15], Fedora는 이 계열의 대안으로 cgroup v2와 PSI<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup> 기반의 systemd-oomd를 표준으로 채택했다[16]. 커널 기본 OOM killer는 메모리가 완전히 바닥난 뒤에야, 그것도 반드시 원인 프로세스를 정확히 겨냥한다는 보장 없이 개입하는 데 비해, 이 둘은 메모리 압박이 심해지는 초기 단계에서 더 예측 가능하게 개입한다.
12. **관측 스택 데이터를 별도 디스크로 분리하는 것 검토.** OS와 앱, Docker 볼륨, Prometheus/Loki/Tempo의 시계열 데이터가 전부 하나의 30GB 루트 디스크에 몰려 있다. Prometheus 공식 문서는 압축 작업이 정상 동작하려면 저장 볼륨에 최소 30%의 여유 공간이 필요하다고 명시하고[17], Loki 공식 문서도 보존 기간 정책을 컴팩터로 강제하는 별도 메커니즘을 두고 있다[18]. 지금은 39% 사용에 그치지만, 관측 데이터가 예상보다 빨리 쌓이면 루트 디스크가 꽉 차면서 OS 자체가 멈추는 최악의 시나리오로 이어질 수 있다. 별도 퍼시스턴트 디스크로 분리하거나, 최소한 보존 기간을 명시적으로 설정해 두는 것이 안전하다.

### 확인했지만 손댈 필요가 없던 것

13. **CPU governor 튜닝은 이 환경에 해당하지 않는다.** 물리 서버라면 `cpufreq` governor를 `performance`로 고정하는 것이 흔한 튜닝 항목이지만, KVM 게스트에는 `/sys/devices/system/cpu/cpu0/cpufreq/` 경로 자체가 노출되지 않았다. 실제 클럭 제어는 하이퍼바이저가 맡고 있어 게스트 안에서는 손댈 지점이 없다는 것을 확인했다. 흔한 체크리스트 항목이지만 이 환경에서는 확인 후 제외하는 것이 맞는 판단이다.

## 우선순위 판단

지금 이 서버는 평시 부하 기준으로는 여유롭다. 그래서 위 열세 가지 중 급한 것은 없지만, 우선순위를 매기면 다음 순서가 합리적이다. 스왑/zram 부재와 컨테이너 리소스 무제한 두 가지는 "평소엔 안 보이다가 부하가 몰리는 순간 한 번에 터지는" 성격의 위험이라 먼저 다루고, THP와 네트워크 백로그 불일치는 이미 k6 테스트에서 봤던 지연 전이나 스파이크 회복 지연과 맞닿아 있어 다음 순서로 둔다. 나머지 커널 파라미터 미세조정은 실제로 부하를 걸어 효과를 재실측하면서 하나씩 적용하는 것이 안전하다.

## 남은 것

이 문서는 조사와 근거 정리까지다. 실제 적용은 프로덕션에 직접 손대는 작업이라 별도 승인과 검증 절차를 거쳐야 하고, 적용한 뒤에는 k6 스위트로 전후 비교를 남기는 것이 이 구현기 트랙의 관례를 따르는 다음 단계가 된다.

## 참고 자료

1. [Changes/SwapOnZRAM (Fedora Project Wiki)](https://fedoraproject.org/wiki/Changes/SwapOnZRAM)
2. [How to Tune vm.swappiness and Swap Behavior on RHEL (OneUptime)](https://oneuptime.com/blog/post/2026-03-04-tune-vmswappiness-and-swap-behavior/view)
3. [zram (ArchWiki)](https://wiki.archlinux.org/title/Zram)
4. [Zram and swappiness (Fedora Discussion)](https://discussion.fedoraproject.org/t/zram-and-swappiness/114899)
5. [Documentation for /proc/sys/vm/ (The Linux Kernel documentation)](https://docs.kernel.org/admin-guide/sysctl/vm.html)
6. [Disable Transparent Hugepages (THP) for Self-Managed Deployments (MongoDB Docs)](https://www.mongodb.com/docs/manual/tutorial/disable-transparent-huge-pages/)
7. [Redis latency due to Transparent Huge Pages (IBM Event Automation)](https://ibm.github.io/event-automation/es/es_2019.2.1/troubleshooting/redis-latency-transparent-huge-pages/)
8. [Tuning the memory management subsystem (SUSE Documentation, SLES)](https://documentation.suse.com/sles/15-SP6/html/SLES-all/cha-tuning-memory.html)
9. [Sysctl configuration for high performance (GitHub Gist)](https://gist.github.com/voluntas/bc54c60aaa7ad6856e6f6a928b79ab6c)
10. [How to Tune Network Kernel Parameters for High-Throughput Workloads on RHEL (OneUptime)](https://oneuptime.com/blog/post/2026-03-04-tune-network-kernel-parameters-high-throughput-rhel-9/view)
11. [Resource constraints (Docker Docs)](https://docs.docker.com/engine/containers/resource_constraints/)
12. [Setting Memory And CPU Limits In Docker (Baeldung on Ops)](https://www.baeldung.com/ops/docker-memory-limit)
13. [How to Use Docker Compose ulimits Configuration (OneUptime)](https://oneuptime.com/blog/post/2026-02-08-how-to-use-docker-compose-ulimits-configuration/view)
14. [Understanding and Configuring ulimits in Linux and Docker (dolpa.me)](https://www.dolpa.me/understanding-and-configuring-ulimits-in-linux-and-docker-a-complete-guide/)
15. [rfjakob/earlyoom (GitHub)](https://github.com/rfjakob/earlyoom)
16. [Changes/EnableSystemdOomd (Fedora Project Wiki)](https://fedoraproject.org/wiki/Changes/EnableSystemdOomd)
17. [Storage (Prometheus Docs)](https://prometheus.io/docs/prometheus/latest/storage/)
18. [Log retention (Grafana Loki documentation)](https://grafana.com/docs/loki/latest/operations/storage/retention/)

<hr>
<ol class="footnotes">
<li id="fn1">Transparent Huge Page. 커널이 애플리케이션 요청 없이 자동으로 메모리를 큰 페이지 단위로 묶어 관리하는 기능. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">디스크 대신 RAM 안에 압축된 영역을 만들어 그곳으로 스왑하는 방식. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">메모리가 완전히 고갈됐을 때 커널이 특정 프로세스를 강제 종료해 시스템을 살리는 안전장치. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">프로세스가 열어 둔 파일이나 소켓 각각을 가리키는 정수 식별자. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">Pressure Stall Information. CPU, 메모리, I/O 자원이 부족해 프로세스가 대기한 시간의 비율을 커널이 직접 측정해 제공하는 지표. <a class="fnback" href="#fnref5">↩</a></li>
</ol>
