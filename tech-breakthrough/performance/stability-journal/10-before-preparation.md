# 10. Before 실행 사전 준비 (0~1번)

**일정**: 2026-07-16
**분류**: `stability` — 09번 계획의 실행 순서 0~1번 기록
**요약**: 09번 문서의 실행 순서 중 실제 테스트(축 A/B/C) 시작 전 단계인 0번(VM 디스크 스냅샷)과 1번(`toggle.sh snapshot`으로 Before 커널값 확정)을 수행한 기록이다. 축 A/B/C 실행 결과는 11번 문서에 별도로 정리한다.

---

## 0번: VM 디스크 스냅샷 (안전망)

```
gcloud compute disks snapshot app-vm --zone=asia-northeast3-a \
  --snapshot-names=app-vm-pre-stability-test-20260716-165440 \
  --storage-location=asia-northeast3
```

결과: `app-vm-pre-stability-test-20260716-165440` (30GB, READY, asia-northeast3) 생성 완료. 이후 실행할 모든 스트레스 테스트가 VM을 회복 불능 상태로 만들 경우의 롤백 경로로 확보해뒀다.

---

## 1번: toggle.sh 작성과 Before 커널값 확정

### 스크립트

`tech-breakthrough/performance/stability-journal/scripts/toggle.sh`에 09번 문서가 정의한 4개 서브커맨드를 전부 구현했다.

```
sudo ./toggle.sh snapshot             # 현재 커널값을 snapshot.json에 저장
sudo ./toggle.sh apply                # 개선값(After)으로 11개 항목 일괄 적용
sudo ./toggle.sh revert               # snapshot.json 값으로 되돌리기
sudo ./toggle.sh revert --only <항목>  # 특정 항목만 되돌리기
```

안전장치: `set -euo pipefail` + 실패 시 즉시 중단, snapshot 없이 revert 시도 시 에러로 차단, 컨테이너 리소스 항목 적용 전 compose 파일 백업과 `docker compose config` 문법 검증(실패 시 자동 롤백), 대상 11개 항목 외에는 손대지 않음.

### 실측한 Before 커널값

`sudo /opt/app/stability-toggle/toggle.sh snapshot` 실행 결과 (`scripts/snapshot.json`):

```json
{
  "vm.swappiness": "60",
  "vm.min_free_kbytes": "67584",
  "vm.dirty_ratio": "20",
  "vm.dirty_background_ratio": "10",
  "vm.vfs_cache_pressure": "100",
  "net.ipv4.tcp_max_syn_backlog": "1024",
  "net.core.rmem_max": "212992",
  "net.core.wmem_max": "212992",
  "thp_enabled": "always",
  "zram_active": false,
  "container_limits_applied": false,
  "container_ulimit_applied": false
}
```

| 항목 | 실측값 | 09번 문서 사전 예측 |
|---|---|---|
| `vm.swappiness` | 60 | 60 (일치) |
| `vm.min_free_kbytes` | 67584 | 65536 (약간 다름) |
| `vm.dirty_ratio` / `dirty_background_ratio` | 20 / 10 | 20 / 10 (일치) |
| `vm.vfs_cache_pressure` | 100 | 100 (일치) |
| `net.ipv4.tcp_max_syn_backlog` | 1024 | 1024 (일치) |
| `net.core.rmem_max` / `wmem_max` | 212992 | 212992 (일치) |
| THP 모드 | always | always (일치) |
| zram / 컨테이너 제한 / ulimit | 전부 미적용 | 전부 미적용 (일치) |

거의 모든 항목이 사전 예측과 일치했고, `min_free_kbytes`만 실측이 조금 더 컸다(문제될 수준은 아님).

이 스냅샷은 이후 app-vm을 stop/start(리사이즈 등)로 재부팅한 뒤에도 다시 확인했으나 값에 드리프트는 없었다 — 커널 파라미터가 부팅 시점의 시스템 상태에 좌우되지 않고 안정적으로 재현됨을 확인했다.
