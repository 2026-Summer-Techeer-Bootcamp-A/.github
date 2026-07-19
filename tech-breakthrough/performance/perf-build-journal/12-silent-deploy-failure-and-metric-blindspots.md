# 조용히 실패하던 배포와 관측을 가리고 있던 사각지대들

**일정**: 2026-07-15 ~ 2026-07-16  
**요약**: k6로 프로덕션 부하 테스트를 재개하려던 시점에, 서버 CPU는 90%까지 오르는데 처리량은 초당 1~2건에 머무는 현상을 발견했다. 원인을 따라 들어가 보니 문제는 하나가 아니라 배포 파이프라인부터 애플리케이션 설정, 관측 스택, 부하 테스트 방법론까지 층층이 쌓여 있었다. 그중 가장 심각했던 것은 배포가 GitHub Actions에서 계속 success로 뜨면서도 실제로는 VM에 전혀 반영되지 않고 있었다는 사실이었다. 관측 자체가 거짓말을 하고 있었기 때문에, 실제 원인을 찾기 전까지는 어떤 수치도 믿을 수 없는 상태였다.  

## 도입 배경

전날 커넥션 풀 크기를 10에서 30으로, 워커 수를 2에서 9로 올리는 성능 개선을 커밋했고, 이 개선이 실제로 효과가 있는지 k6 스트레스 테스트로 확인하려 했다. 그런데 테스트를 돌릴 때마다 CPU 사용률만 치솟을 뿐 처리량은 거의 늘지 않았다. 어제 밤에 커밋한 수정이 반영됐다면 나올 수 없는 수치였고, 이 모순에서 조사가 시작됐다.

## 1차 발견: buildx 컨테이너 빌더와 gcloud credential helper의 불일치

배포 자체가 실패하고 있었다. CI 속도 개선을 위해 `docker/setup-buildx-action`을 도입하면서 BuildKit이 별도 컨테이너에서 실행되기 시작했는데, 이 컨테이너 안에는 `gcloud` CLI가 없어서 `gcloud auth configure-docker`가 심어둔 credential helper를 실행할 수 없었다. 그 결과 이미지 push와 GHA 캐시 export가 모두 `error getting credentials`로 실패했다. 해결은 credential helper 대신 `google-github-actions/auth`의 access token으로 `docker/login-action` 통해 직접 로그인하는 방식으로 바꾸는 것이었다. 이러면 BuildKit이 외부 바이너리를 exec할 필요 없이 `~/.docker/config.json`의 평범한 basic auth 항목을 그대로 읽을 수 있다.

## 2차 발견: 배포 성공 표시와 실제 무동작

credential 문제를 고치고 나서도 이상한 점이 있었다. 재배포 후에도 VM의 컨테이너 이미지 ID와 시작 시각이 전혀 바뀌지 않은 것이다. 원인은 `deploy.yml`의 SSH 배포 스텝이 `| tee deploy_out.txt`로 파이프되어 있었다는 데 있었다. 셸 파이프라인의 종료 코드는 마지막 명령, 즉 `tee`의 것이 되기 때문에, 그 앞의 `docker compose pull && docker compose up -d`가 실패해도 `tee` 자체는 정상 종료하니 GitHub Actions는 그 실패를 절대 볼 수 없었다. 실제로 VM에 SSH로 들어가 수동으로 pull을 돌려보니 `no space left on device`로 죽고 있었다. 디스크가 95%(30GB 중 27GB) 차 있었고, 그중 22.7GB가 정리된 적 없는 예전 이미지 레이어였다. 이 두 가지를 함께 고쳤다. `set -o pipefail`로 진짜 실패가 드러나게 했고, 배포 스텝 마지막에 `docker image prune -af`를 추가해 레이어가 다시 쌓이지 않게 했다.

## 3차 발견: 미사용 CUDA 스택의 이미지 포함

디스크가 왜 이렇게 빨리 찼는지를 보다가, 이미지 레이어 중 하나가 2.94GB짜리라는 걸 알게 됐다. `sentence-transformers`가 RAG 쿼리 임베딩(BGE-M3, CPU 전용)을 위해 의존성으로 들어가 있는데, 정작 `torch`를 설치할 때 CPU 전용 wheel 인덱스를 지정하지 않아서 PyPI 기본값인 CUDA 지원 빌드가 설치되고 있었다. PyTorch 2.x부터는 CUDA 런타임이 `nvidia-cublas-cu12`, `nvidia-cusparselt`, `cuda-toolkit` 같은 별도 pip 패키지로 쪼개져서 자동으로 딸려 온다. 이 서버엔 GPU가 없고 임베딩도 CPU로만 도는데, 매 빌드마다 GB 단위의 죽은 무게를 내려받고 있었던 셈이다. `requirements.txt` 최상단에 `--extra-index-url https://download.pytorch.org/whl/cpu`를 추가해 해결했다. 효과는 즉시 드러났다. `test/docker-build` 잡의 소요 시간이 18분 5초에서 4분 23초로 줄었고, 최종 이미지 용량도 눈에 띄게 작아졌다.

## 4차 발견: 커넥션 풀 수정의 미배포

디스크를 비우고 나서 실제로 `docker compose pull`을 다시 돌려보니, 그제야 어제 커밋한 `pool_size=30` 코드가 VM에 반영됐다. 즉 하루 전에 "완료했다"고 여겼던 커넥션 풀 개선은, tee 마스킹과 디스크 부족이 겹치면서 단 한 번도 실제 프로덕션에 올라간 적이 없었다. GitHub Actions의 초록불과 실제 배포 상태가 완전히 분리되어 있었다는 뜻이고, 이 사실을 눈치채지 못했다면 앞으로도 계속 "이미 고친 문제"를 붙잡고 헤맸을 것이다.

## 5차 발견: 멀티워커 환경에서 /metrics의 단일 워커 값 표시

배포를 바로잡은 뒤 다시 부하 테스트를 돌렸는데, DB 커넥션은 5%대로 한가하고 앱 CPU도 낮은데 Grafana의 처리량은 여전히 1 req/s 근처에 머물렀다. `prometheus-fastapi-instrumentator`의 기본 `/metrics`는 프로세스 하나짜리 인메모리 레지스트리를 기준으로 응답한다. `--workers 9`로 띄우면 워커마다 완전히 별도의 OS 프로세스가 뜨고 각자 자기만의 레지스트리를 갖는데, 스크레이프 요청이 9개 워커 중 우연히 도착한 곳 하나의 값만 보여주고 있었던 것이다. 실제로 컨테이너 안에서 직접 `/metrics`를 두 번 호출해 보니 매번 다른, 그리고 훨씬 작은 숫자가 나왔다. `PROMETHEUS_MULTIPROC_DIR`을 설정해 워커들이 공유 파일에 값을 쓰게 하고, `/metrics` 라우트를 `MultiProcessCollector`로 그 파일들을 합산해서 응답하도록 바꿨다. 이 디렉터리는 워커가 fork되기 전에 한 번만 비워야 하는데(워커별 lifespan 훅에서 하면 서로의 파일을 지우는 경쟁이 생긴다), 컨테이너의 `entrypoint.sh`에서 uvicorn을 exec하기 전에 처리하도록 분리했다. 테스트 venv처럼 그 환경변수가 없는 곳에서는 기본 레지스트리로 폴백하는 예외 처리도 추가했다.

## 6차 발견: 부하 테스트 데이터의 연속 오염

관측을 다 바로잡은 뒤에도 여전히 이상한 수치가 나왔는데, 이번엔 서버가 아니라 테스트 방법론이 원인이었다. 첫 시도는 로컬 PC에서 k6로 500 VU를 프로덕션 도메인에 직접 쐈는데, k6 UI는 "500/500 VU 실행 중"이라고 보여줬지만 서버 쪽 누적 요청 수는 재시작 이후 150건 남짓에 불과했다. 가정용 회선과 공유기가 500개의 동시 아웃바운드 HTTPS 커넥션을 감당하지 못해 VU 슬롯은 할당됐지만 실제 요청은 나가지도 못하고 있었던 것이다. 두 번째 시도는 이 문제를 피하려고 k6를 VM 안에 설치해서 직접 쐈는데, 이번엔 반대 방향의 오염이 일어났다. 앱 워커 9개, k6 프로세스, 그리고 Grafana, Loki, Tempo, Prometheus, Alloy를 포함한 관측 스택 전체가 단 4개의 vCPU를 나눠 쓰면서, 부하 생성기 자신이 병목의 일부가 되어버렸다. 이때는 DB를 전혀 건드리지 않는 `/metrics`조차 p95 1분까지 치솟았는데, `/healthz`만 유독 빠르게 응답한 것이 결정적 단서였다. 특정 쿼리나 엔드포인트의 문제가 아니라, VM 전체가 CPU를 못 받아 아무 요청도 제때 처리되지 못하는 상태였다. 부하 생성기와 타겟 서버가 자원을 나눠 쓰면 안 된다는, 부하 테스트의 기본 원칙을 다시 확인한 셈이다.

## 7차 발견: uvicorn과 맞지 않는 워커 수 공식

VM 안에서 돌린 부하 테스트가 자원 경합으로 오염됐다는 걸 확인한 김에,애초에 워커를 9개로 잡은 근거 자체를 다시 짚었다. `(2*cores)+1=9`는 요청 하나가 스레드 하나를 블로킹하는 동기 워커(Gunicorn sync worker)를 위한 공식이다. uvicorn 워커는 그 자체가 이미 비동기 이벤트 루프라서 I/O 바운드 요청은 워커 하나로도 상당한 동시성을 처리하고, 워커를 늘리는 목적은 동시 연결 수가 아니라 CPU 코어 활용이다. 이 VM은 4 vCPU를 uvicorn뿐 아니라 Traefik, Prometheus, Loki, Tempo, Grafana, Alloy와도 나눠 쓰므로 9는 명백한 과할당이었고, 어제 CPU 오버섭스크립션으로 부하 테스트가 무너진 것도 이 설정이 한몫했다. 워커를 vCPU 수에 맞춰 4로 낮췄다. 워커당 SQLAlchemy 커넥션 풀(`pool_size=30, max_overflow=10`)의 총 상한도 `workers * 40`이므로, 워커를 줄이면 최대 커넥션 요청량이 360에서 160으로 줄어 2 vCPU짜리 DB(`db-custom-2-7680`) 쪽 부담도 같이 낮아진다. 로컬(`docker-compose.yml`, `Dockerfile`)에 커밋(`3a4163d`, 아직 push 안 함)했고, 프로덕션은 다음 git 기반 배포를 기다리지 않고 VM에 SSH로 들어가 `/opt/app/docker-compose.yml`을 직접 고치고 `docker compose up -d app`으로 즉시 반영했다.

## 결론 및 다음 단계

이번 조사는 하나의 원인이 아니라 배포 파이프라인, 애플리케이션 설정, 관측 스택, 테스트 방법론 네 층 모두에서 문제가 겹쳐 있었다는 걸 보여줬다. 특히 tee로 인한 배포 실패 마스킹은 가장 위험한 유형의 버그였다. 실패가 실패로 보이지 않았기 때문에, 그 위에서 아무리 옳은 수정을 커밋해도 프로덕션에는 영영 반영되지 않았을 것이다. 관측(observability)이 거짓말을 하면 그 위의 모든 판단이 틀어진다는 교훈을 다시 얻었다.

남은 과제는 부하 테스트를 오염 없이 재현하는 것이다. 로컬 PC는 클라이언트 네트워크가, 타겟 VM 자신은 자원 경합이 병목이 되므로, 같은 GCP 리전 안에 타겟과 분리된 별도의 소형 VM을 부하 생성 전용으로 띄워서 다시 측정해야 한다. 그래야 500 VU에서 실제로 무너지는 지점이 서버의 진짜 용량 한계인지, 아니면 여전히 다른 사각지대가 남아있는지 구분할 수 있다.

다음 세션에서 만들 부하 생성 전용 인스턴스 사양을 정해뒀다. `e2-medium`(2 vCPU, 4GB), `app-vm`과 같은 존인 `asia-northeast3-a`(네트워크 왕복 지연을 없애기 위함, 단 반드시 별도 VM), provisioning-model은 `SPOT`(테스트 끝나면 지울 일회성 용도라 저렴한 쪽이 합리적), 이미지는 k6 바이너리만 받으면 되므로 Debian 12 minimal이면 충분하다. 참고용 생성 명령은 다음과 같다.

```
gcloud compute instances create k6-loadgen \
  --zone=asia-northeast3-a \
  --machine-type=e2-medium \
  --provisioning-model=SPOT \
  --image-family=debian-12 \
  --image-project=debian-cloud
```
