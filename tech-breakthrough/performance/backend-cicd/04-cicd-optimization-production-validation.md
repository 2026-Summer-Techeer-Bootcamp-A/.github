# 최적화 4종 세트의 실전 검증: 캐싱과 병렬화가 실제 배포 파이프라인에서 만든 결과

- 작성일자: 2026-07-15

## 배경 및 검증의 필요성

02번 문서는 린트 전용 액션, 가상환경 캐싱, 도커 레이어 캐싱, 작업 병렬화라는 네 가지 최적화 기법을 설계하면서 실제 성능 지표 칸을 측정 예정으로 비워 두었고, 03번 문서 역시 테스트 전용 경량 의존성 분리와 도커 멀티스테이지 빌드, 모델 가중치 볼륨 마운트, concurrency 취소 규칙을 추가로 얹으면서 이미지 용량과 패키지 설치 시간이라는 부분 지표만 남긴 채 파이프라인 전체가 실전에서 어떻게 도는지는 다루지 않았다. 두 문서에서 설계한 기법이 모두 main 브랜치의 워크플로 파일에 반영된 뒤, 옵저버빌리티 버그 하나를 고친 커밋<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>이 main에 푸시되며 배포 워크플로가 트리거되었고, 그 실행 기록이 지금까지 유보해 둔 질문에 답을 주었다.

## 실행 결과와 잡 사이의 의존 관계

`.github/workflows/deploy.yml`은 `test.yml`을 재사용 워크플로로 호출하고, `test.yml` 안의 `unit`과 `lint`는 서로 독립적으로 시작되며 `docker-build`는 `unit`을, `integration`은 `lint`와 `unit`을 각각 기다린 뒤 시작된다. 두 경로가 모두 끝나야 `test` 잡 전체가 성공으로 표시되고, 그래야만 `deploy`가 `needs: test` 게이트를 통과해 실행된다. 이번 실행에서 각 잡이 실제로 걸린 시간은 다음과 같다.

<figure>
<svg viewBox="0 0 720 236" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="배포 워크플로 잡 의존 관계와 실측 소요 시간">
  <defs><marker id="d1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker></defs>
  <rect x="24" y="24" width="112" height="52" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="80" y="46" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">test / unit</text>
  <text x="80" y="65" font-size="11" fill="#5b5e66" text-anchor="middle">17초</text>
  <rect x="24" y="106" width="112" height="52" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="80" y="128" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">test / lint</text>
  <text x="80" y="147" font-size="11" fill="#5b5e66" text-anchor="middle">8초</text>
  <path d="M136 50 H176" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#d1)"/>
  <rect x="180" y="24" width="150" height="52" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="255" y="46" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">test / docker-build</text>
  <text x="255" y="65" font-size="11" fill="#5b5e66" text-anchor="middle">59초 · needs: unit</text>
  <path d="M136 62 C158 62 158 132 176 132" fill="none" stroke="#8a8d95" stroke-width="1.4" marker-end="url(#d1)"/>
  <path d="M136 132 H176" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#d1)"/>
  <rect x="180" y="106" width="150" height="52" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="255" y="128" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">test / integration</text>
  <text x="255" y="147" font-size="11" fill="#5b5e66" text-anchor="middle">33초 · needs: lint, unit</text>
  <path d="M330 50 C368 50 368 90 400 90" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#d1)"/>
  <path d="M330 132 C368 132 368 90 400 90" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#d1)"/>
  <rect x="404" y="64" width="130" height="52" rx="8" fill="#21447c"/>
  <text x="469" y="86" font-size="12.5" font-weight="700" fill="#ffffff" text-anchor="middle">deploy</text>
  <text x="469" y="105" font-size="11" fill="#c7d3e8" text-anchor="middle">1분 25초 · needs: test</text>
  <rect x="24" y="188" width="672" height="34" rx="8" fill="#f7f8fa" stroke="#e4e6ec"/>
  <text x="360" y="209" font-size="11.5" fill="#5b5e66" text-anchor="middle">임계 경로는 unit(17초) → docker-build(59초) → deploy(1분25초)이며, lint → integration 경로(41초)는 그보다 짧아 대기 없이 합류한다.</text>
</svg>
<figcaption><b>그림 1.</b> 배포 워크플로의 실제 잡 의존 관계와 실측 소요 시간. 두 경로가 병렬로 돌지만 <code>unit → docker-build</code> 경로가 더 길어 전체 완료 시각을 결정한다.<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup></figcaption>
</figure>

실행 로그의 타임스탬프를 그대로 따라가면 이 그림이 왜 이렇게 그려졌는지 드러난다. `unit`과 `lint`는 워크플로 시작 3, 4초 뒤 거의 동시에 시작해 각각 17초와 8초 만에 끝났다. `docker-build`는 `unit`이 끝난 직후, `integration`은 `lint`와 `unit`이 모두 끝난 직후 시작해 각각 59초와 33초를 썼다. `deploy`는 `docker-build`가 끝난 2초 뒤 시작해 85초 만에 끝났다. 워크플로 생성 시각부터 완료 시각까지 잰 전체 wall clock은 2분 50초였는데, 이는 우연이 아니라 3초(대기) + 17초(unit) + 3초(대기) + 59초(docker-build) + 2초(대기) + 85초(deploy) + 1초(마무리)를 그대로 더한 값과 일치한다. 즉 `lint → integration` 경로는 41초 만에 끝나 여유 있게 합류를 기다렸을 뿐, 실제 파이프라인 속도를 결정한 것은 `unit → docker-build → deploy`라는 더 긴 경로였다.

## 단계별 적용 기법

### 린트, 8초

02번 문서에서 도입한 Ruff 전용 액션이 그대로 작동했다. 가상환경을 구축하지 않고 러너에 이미 있는 경량 런타임으로 곧장 검사만 수행하므로, 프로젝트 코드 전체를 훑고도 한 자리 수 초 안에 끝난다.

### 유닛과 통합, 17초와 33초

두 잡 모두 `actions/cache@v4`로 `.venv` 디렉터리를 캐싱하고, 캐시 키를 `requirements-test.txt`의 해시값으로 잡는다. 03번 문서에서 `sentence-transformers`를 뺀 경량 의존성 목록을 별도로 분리해 두었기 때문에, 이 파일이 바뀌지 않는 한 캐시 키는 그대로 유지되고 `Install dependencies` 스텝은 조건문(`if: steps.cache-venv.outputs.cache-hit != 'true'`)에 걸려 통째로 건너뛰어진다. 실제로 이번 실행의 `unit` 잡 로그에는 `Install dependencies` 스텝이 스킵 아이콘과 함께 0초로 찍혀 있는데, 이것이 캐시가 실제로 히트했다는 직접적인 증거다. 설치를 건너뛴 만큼 남는 시간은 테스트 실행 자체뿐이라, 220여 개 중 215개를 도는 `unit`이 17초, 실 Postgres 서비스 컨테이너를 띄우고 헬스체크를 기다린 뒤 5개를 도는 `integration`이 33초로 끝났다.

### 도커 빌드, 59초

이 단계는 다른 단계만큼 극적으로 줄지 않았고, 그 이유를 정직하게 짚을 필요가 있다. `docker/build-push-action@v6`이 `cache-from: type=gha`로 이전 빌드가 남긴 레이어 캐시를 그대로 읽어 오기는 하지만, 03번 문서에서 Dockerfile을 단일 스테이지에서 `builder`와 `runner`로 나누는 멀티스테이지 구조로 바꾸면서 `build-essential`과 `libpq-dev`를 설치하고 파이썬 패키지를 컴파일하는 별도의 빌더 스테이지가 새로 생겼다. 캐시가 히트하더라도 두 스테이지를 오가며 레이어를 재구성하는 오버헤드 자체는 남기 때문에, 이 잡의 절대 시간은 다른 잡들만큼 짧아지지 않았다. 대신 그 대가로 최종 이미지는 03번 문서가 측정한 대로 2.94GB에서 212MB로 92.7% 줄었고, 그 절감분이 고스란히 다음 단계로 넘어갔다.

### 배포, 1분 25초

가장 큰 폭으로 줄어든 단계다. `deploy` 잡 안의 `docker/build-push-action@v6` 역시 `cache-from: type=gha`를 쓰는데, 같은 워크플로 실행 안에서 `test / docker-build` 잡이 조금 전에 `cache-to: type=gha,mode=max`로 채워 둔 캐시를 그대로 읽을 수 있다. GitHub Actions의 캐시는 저장소와 브랜치 단위로 스코프가 잡히므로, 같은 커밋에 대해 앞서 실행된 잡이 남긴 레이어 캐시를 뒤에 실행되는 잡이 그대로 재사용하는 구조다.<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup> 여기에 212MB로 줄어든 이미지가 Artifact Registry로의 푸시와 VM에서의 `docker compose pull` 양쪽을 모두 짧게 만들었고, `concurrency` 취소 규칙 덕분에 이전 실행과 자원을 나눠 쓰며 대기하는 시간도 없었다. 허깅페이스 모델 가중치가 `HF_HOME=/models` 볼륨에 상주해 이미지 자체에는 전혀 영향을 주지 않는다는 점도 이미지가 가벼운 채로 유지되는 데 한몫했다. 이 네 가지가 겹치며 9분 11초였던 배포 단계가 1분 25초로 줄었다.

## 최적화 전후 종합 비교

02번 문서가 남겨 둔 Deploy 워크플로우 표의 측정 예정 칸을 이번 실행값으로 채우면 다음과 같다.

| 파이프라인 단계 | 최적화 전 (#72 빌드) | 최적화 후 (#85 빌드, 이번 실행) | 개선율 |
| :--- | :--- | :--- | :--- |
| 린트 검사 | 1분 48초 | 8초 | 약 92.6% 단축 |
| 단위 테스트 | 2분 23초 | 17초 | 약 88.1% 단축 |
| 통합 테스트 | 2분 25초 | 33초 | 약 77.2% 단축 |
| 도커 빌드 | 1분 32초 | 59초 | 약 35.9% 단축 |
| 프로덕션 배포 | 9분 11초 | 1분 25초 | 약 84.6% 단축 |
| **전체 워크플로 wall clock** | **15분 58초** | **2분 50초** | **약 82.3% 단축** |

<figure>
<svg viewBox="0 0 760 168" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="배포 워크플로 전체 소요 시간 개선 전후 비교">
  <text x="24" y="30" font-size="12" fill="#8a8d95">개선 이전 (#72)</text>
  <rect x="140" y="16" width="596" height="28" rx="5" fill="#fbeae6" stroke="#b3402f"/>
  <text x="746" y="36" font-size="12.5" font-weight="700" fill="#b3402f" text-anchor="end">15분 58초</text>
  <text x="24" y="90" font-size="12" fill="#21447c">개선 이후 (#85)</text>
  <rect x="140" y="76" width="106" height="28" rx="5" fill="#eef2f9" stroke="#21447c"/>
  <text x="256" y="96" font-size="12.5" font-weight="700" fill="#21447c">2분 50초</text>
  <rect x="24" y="128" width="712" height="30" rx="8" fill="#f7f8fa" stroke="#e4e6ec"/>
  <text x="380" y="148" font-size="11.5" fill="#5b5e66" text-anchor="middle">막대 길이는 실제 wall clock 비율(958초 대비 170초, 약 82.3% 단축)에 비례한다.</text>
</svg>
<figcaption><b>그림 2.</b> 배포 워크플로 전체 wall clock 개선 전후. 02번 문서의 네 가지 최적화와 03번 문서의 추가 튜닝이 모두 반영된 결과다.</figcaption>
</figure>

## 남은 과제

이번 실행의 annotation에는 `actions/cache@v4`, `actions/checkout@v4`, `actions/setup-python@v5`, `docker/build-push-action@v6`, `docker/setup-buildx-action@v3`를 포함한 여러 액션이 Node.js 20 지원 종료 경고를 냈다.<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup> 아직 실행 자체는 러너가 Node.js 24로 강제 전환해 문제없이 도는 상태지만, 지원이 완전히 끊기기 전에 각 액션의 메이저 버전을 올려 두는 편이 안전하다. 또한 이번에 채운 것은 Push로 트리거되는 Deploy 워크플로우 표뿐이고, PR 기준 CI 워크플로우 표는 여전히 측정 예정으로 남아 있다. 다음 PR 빌드가 돌 때 같은 방식으로 채워 넣으면 된다.

## 회고

02번과 03번 문서에서 설계만 하고 유보해 둔 숫자를 이번 실행이 채워 주었고, 결과는 대체로 설계 의도와 일치했다. 다만 도커 빌드 단계만은 그렇지 않았다는 점이 오히려 이 검증에서 가장 눈여겨볼 대목이다. 캐시를 붙였다고 모든 단계가 균일하게 빨라지는 것은 아니고, 멀티스테이지 빌드처럼 다른 목적을 위해 구조 자체를 바꾼 단계는 캐시가 있어도 절대 시간이 크게 줄지 않을 수 있다. 대신 그 단계가 만들어 낸 결과물, 즉 92.7% 줄어든 이미지가 바로 뒤 단계인 배포에서 압도적인 개선으로 돌아왔다. 한 단계의 초 단위 숫자만 보고 최적화의 성패를 판단하지 않고 파이프라인 전체의 wall clock으로 봐야 한다는 것이 이번 실전 검증이 남긴 교훈이다.

<hr>
<ol class="footnotes">
<li id="fn1">"fix(observability): PROMETHEUS_MULTIPROC_DIR 없는 환경에서 /metrics 500 나던 것 수정", 커밋 f6fa5c3. 테스트 venv가 entrypoint.sh를 거치지 않아 PROMETHEUS_MULTIPROC_DIR이 없는 상태에서 MultiProcessCollector가 예외를 던지던 것을, 환경변수가 없을 때는 단일 프로세스 기본 레지스트리로 폴백하도록 고친 커밋이다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">각 잡의 시작·종료 시각과 전체 워크플로 wall clock은 GitHub Actions 실행 #85(run ID 29433122162)의 API 응답에 찍힌 타임스탬프를 그대로 옮긴 값이다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">GitHub Actions의 캐시(actions/cache 백엔드를 공유하는 type=gha 포함)는 저장소와 브랜치 참조 단위로 스코프가 잡힌다. 같은 워크플로 실행 안에서 먼저 끝난 잡이 cache-to로 내보낸 레이어를, needs로 뒤에 실행되는 잡이 cache-from으로 그대로 읽어 갈 수 있다. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">GitHub은 2025년 9월 이후 Node.js 20을 쓰는 액션을 당분간 Node.js 24로 강제 실행시키되, 액션 자체는 Node.js 20 기준으로 계속 경고를 낸다고 공지했다. <a class="fnback" href="#fnref4">↩</a></li>
</ol>
