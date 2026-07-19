# CI/CD 고급 튜닝: 경량 테스트 의존성 분리, 도커 멀티스테이지 및 볼륨 마운트를 통한 이미지 경량화, 빌드 동시성 제어

- 작성일자: 2026-07-15

## 배경 및 도입 취지

기존의 CI/CD 워크플로우와 도커 빌드 파이프라인은 프로젝트 규모가 확장됨에 따라 몇 가지 치명적인 성능 저하 요인을 노출했다. 첫째, 딥러닝 기반의 임베딩 모델 처리를 위해 추가된 `sentence-transformers`<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup> 라이브러리와 이에 종속된 대형 파이썬 패키지들이 단순 단위 테스트 단계에서도 매번 내려받아져 가상환경을 구축하는 구조였다. 이는 단순 코드 포맷팅이나 기초 단위 테스트 수행 속도를 대폭 느려지게 만드는 원인이었다. 둘째, 기존 Dockerfile은 단일 스테이지로 구성되어 의존성 설치 과정에서 발생한 각종 컴파일 부산물과 개발 도구가 최종 이미지에 그대로 남아 빌드 파일의 용량이 2.94GB에 이르는 심각한 이미지 비대화 문제를 겪고 있었다. 또한 허깅페이스의 무거운 인공지능 가중치 모델들이 컨테이너 이미지 자체에 구워지거나 구동 시마다 매번 새로 학습 데이터급의 가중치 파일을 다운로드받는 비효율을 품고 있었다. 마지막으로 워크플로우 실행 시 짧은 주기로 반복되는 커밋이나 풀 리퀘스트에 대해 이전에 실행 중이던 동일 브랜치의 빌드가 자동 취소되지 않고 중복으로 동시 실행되어 전체 배포 큐가 밀리고 컴퓨팅 자원이 낭비되는 동시성 제어 부재 문제도 발견되었다. 이러한 병목을 해결하기 위해 경량화 테스트 의존성의 분리, 도커 멀티스테이지 빌드와 볼륨 마운트를 통한 이미지 및 모델 가중치의 디커플링, 그리고 워크플로우 중복 방지 제어를 순차적으로 적용하여 파이프라인 전반의 성능을 극대화하고자 했다.

<figure>
<svg viewBox="0 0 720 168" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="이미지 용량 개선 전후 비교">
  <text x="24" y="30" font-size="12" fill="#8a8d95">개선 이전</text>
  <rect x="120" y="16" width="596" height="28" rx="5" fill="#fbeae6" stroke="#b3402f"/>
  <text x="726" y="36" font-size="12.5" font-weight="700" fill="#b3402f" text-anchor="end">2.94 GB</text>
  <text x="24" y="90" font-size="12" fill="#21447c">개선 이후</text>
  <rect x="120" y="76" width="43" height="28" rx="5" fill="#eef2f9" stroke="#21447c"/>
  <text x="173" y="96" font-size="12.5" font-weight="700" fill="#21447c">212 MB</text>
  <rect x="24" y="128" width="672" height="30" rx="8" fill="#f7f8fa" stroke="#e4e6ec"/>
  <text x="360" y="148" font-size="11.5" fill="#5b5e66" text-anchor="middle">막대 길이는 실제 용량 비율(2.94GB 대비 212MB, 약 92.7% 절감)에 비례한다.</text>
</svg>
<figcaption><b>그림 1.</b> 멀티스테이지 전환 전후 이미지 용량. 빌드 도구와 컴파일 부산물이 최종 이미지에서 빠지면서 용량이 십분의 일 이하로 줄었다.</figcaption>
</figure>

## 구현 상세

### 테스트 전용 경량 의존성 분리
가장 먼저 전체 개발 및 서비스 환경에서 핵심적인 무거운 ML 라이브러리인 `sentence-transformers`를 분리해내기로 결정했다. 이를 위해 개발 의존성과 서비스 구동 의존성을 합치되 인공지능 패키지만 제외한 `requirements-test.txt` 파일을 새롭게 작성했다. 기존의 테스트 워크플로우 파일인 `backend/.github/workflows/test.yml`을 수정하여 가상환경 캐시 키 해싱 기준을 `requirements.txt` 대신 새롭게 생성한 `requirements-test.txt`로 재정의했으며 패키지 설치 단계 역시 해당 파일을 사용하도록 개선했다. 이를 통해 백엔드 기능 테스트 중 머신러닝 모델이 관여하지 않는 90% 이상의 유닛 테스트 영역에서 빌드 속도가 대폭 향상되었고 불필요한 네트워크 대역폭 소모를 원천 차단했다.

### 도커 멀티스테이지 빌드 및 볼륨 마운트 분리
도커 이미지 자체의 경량화를 달성하기 위해 `backend/Dockerfile`을 2단계 빌드 구조<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>로 전면 개편했다. 빌더 스테이지에서 컴파일 도구인 `build-essential`과 `libpq-dev`<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup>를 활용해 파이썬 패키지들을 특정 디렉토리에 설치했고 러너 스테이지에서는 오직 설치가 완료된 파이썬 패키지 환경과 실행 바이너리들만을 복사하여 최소한의 레이어만으로 실행 가능한 초경량 런타임을 구성했다.

<figure>
<svg viewBox="0 0 720 220" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="도커 멀티스테이지 빌드 구조">
  <defs><marker id="s4" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker></defs>
  <rect x="24" y="20" width="320" height="176" rx="12" fill="#fafbfc" stroke="#8a8d95" stroke-dasharray="5 4"/>
  <text x="44" y="44" font-size="12" font-weight="700" fill="#5b5e66">builder 스테이지</text>
  <g font-size="11.5" fill="#1a1c20">
    <text x="44" y="76">build-essential, libpq-dev 설치</text>
    <text x="44" y="102">파이썬 패키지 컴파일 및 설치</text>
    <text x="44" y="128">빌드 도구, 캐시, 부산물 남음</text>
  </g>
  <rect x="44" y="150" width="264" height="30" rx="6" fill="#eef2f9" stroke="#21447c"/>
  <text x="176" y="170" font-size="11" fill="#21447c" text-anchor="middle">설치된 패키지 디렉토리만 다음 단계로</text>
  <path d="M344 108 H396" fill="none" stroke="#21447c" stroke-width="1.8" marker-end="url(#s4)"/>
  <text x="370" y="98" font-size="10.5" fill="#21447c" text-anchor="middle">COPY --from=builder</text>
  <rect x="400" y="20" width="296" height="176" rx="12" fill="#ffffff" stroke="#21447c"/>
  <text x="420" y="44" font-size="12" font-weight="700" fill="#21447c">runner 스테이지</text>
  <g font-size="11.5" fill="#1a1c20">
    <text x="420" y="76">설치 완료된 패키지 환경</text>
    <text x="420" y="102">실행 바이너리와 애플리케이션 코드</text>
    <text x="420" y="128">빌드 도구, 컴파일 부산물 없음</text>
  </g>
  <rect x="420" y="150" width="256" height="30" rx="6" fill="#eef2f9" stroke="#21447c"/>
  <text x="548" y="170" font-size="11" fill="#21447c" text-anchor="middle">최종 이미지 = 이 레이어만</text>
</svg>
<figcaption><b>그림 2.</b> 멀티스테이지 빌드 구조. builder 스테이지의 컴파일 도구와 중간 산출물은 최종 이미지에 포함되지 않고, 설치가 끝난 결과물만 runner 스테이지로 복사된다.</figcaption>
</figure>

동시에 인공지능 가중치 파일로 인한 디스크 점유 현상을 해결하기 위해 `docker-compose.yml` 및 `docker-compose.dev.yml` 파일에서 컨테이너 내부 환경 변수에 허깅페이스 모델 저장 경로를 `HF_HOME=/models`<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup>로 지정한 뒤 호스트 장치의 볼륨 영역에 상주하는 고유 볼륨인 `model-cache`를 `/models` 경로에 직접 마운트시켰다. 이 조치를 통해 가중치 데이터가 호스트 시스템의 영구 저장소에 남게 되어 최초 1회 다운로드 이후로는 로컬 디스크 캐시를 읽게 되며 대형 가중치를 더 이상 도커 레이어 안에 담을 필요가 없어졌다.

<figure>
<svg viewBox="0 0 720 180" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="모델 가중치 볼륨 마운트 구조">
  <defs><marker id="s5" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker></defs>
  <rect x="24" y="24" width="280" height="120" rx="12" fill="#ffffff" stroke="#21447c"/>
  <text x="44" y="50" font-size="12" font-weight="700" fill="#21447c">컨테이너</text>
  <text x="44" y="76" font-size="11.5" fill="#1a1c20">HF_HOME=/models</text>
  <text x="44" y="98" font-size="10.5" fill="#8a8d95">sentence-transformers가 이 경로에서</text>
  <text x="44" y="114" font-size="10.5" fill="#8a8d95">가중치를 읽고 쓴다</text>
  <path d="M304 84 H392" fill="none" stroke="#21447c" stroke-width="1.8" marker-end="url(#s5)"/>
  <text x="348" y="74" font-size="10.5" fill="#21447c" text-anchor="middle">마운트</text>
  <rect x="396" y="24" width="300" height="120" rx="12" fill="#eef2f9" stroke="#21447c"/>
  <text x="416" y="50" font-size="12" font-weight="700" fill="#21447c">호스트 볼륨 model-cache</text>
  <text x="416" y="76" font-size="11.5" fill="#1a1c20">최초 1회 다운로드 후 영구 보관</text>
  <text x="416" y="98" font-size="10.5" fill="#8a8d95">컨테이너를 재시작하거나 이미지를</text>
  <text x="416" y="114" font-size="10.5" fill="#8a8d95">다시 빌드해도 가중치는 유지된다</text>
  <rect x="24" y="156" width="672" height="0" fill="none"/>
</svg>
<figcaption><b>그림 3.</b> 모델 가중치는 도커 이미지 레이어가 아니라 호스트 볼륨에 산다. 이미지를 다시 빌드해도 가중치 재다운로드가 필요 없다.</figcaption>
</figure>

### 워크플로우 동시성 취소 규칙 정의
짧은 주기로 다수의 커밋이 발생할 때 이전 작업들이 잔존하여 깃허브 액션즈의 빌드 러너를 독점하는 현상을 막고자 했다. 이를 위해 테스트와 배포 관련 배포 액션 YAML 스크립트 트리거 하단에 `concurrency` 설정<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup>을 선언했다. 워크플로우 이름과 깃 참조 브랜치를 묶어 고유 그룹으로 명명했으며 동일 브랜치 상에 새로운 빌드가 감지되면 실행 중이던 이전 단계 빌드는 즉시 중단되도록 처리하여 불필요한 자원 낭비를 근절했다.

<figure>
<svg viewBox="0 0 720 240" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="concurrency 취소 규칙 타임라인">
  <text x="24" y="24" font-size="11" font-weight="700" fill="#8a8d95">도입 전</text>
  <rect x="24" y="34" width="300" height="30" rx="6" fill="#ffffff" stroke="#8a8d95"/>
  <text x="174" y="54" font-size="11" fill="#5b5e66" text-anchor="middle">커밋 1 빌드 (계속 실행)</text>
  <rect x="200" y="72" width="300" height="30" rx="6" fill="#fbeae6" stroke="#b3402f"/>
  <text x="350" y="92" font-size="11" fill="#b3402f" text-anchor="middle">커밋 2 빌드 (동시 실행, 큐 대기 유발)</text>
  <text x="24" y="122" font-size="10.5" fill="#8a8d95">두 빌드가 자원을 나눠 쓰며 함께 끝날 때까지 대기 시간이 누적된다.</text>
  <line x1="24" y1="140" x2="696" y2="140" stroke="#e4e6ec"/>
  <text x="24" y="164" font-size="11" font-weight="700" fill="#21447c">도입 후</text>
  <rect x="24" y="174" width="152" height="30" rx="6" fill="#f7f8fa" stroke="#8a8d95" stroke-dasharray="3 3"/>
  <text x="100" y="194" font-size="11" fill="#8a8d95" text-anchor="middle">커밋 1 빌드 취소됨</text>
  <rect x="200" y="174" width="300" height="30" rx="6" fill="#eef2f9" stroke="#21447c"/>
  <text x="350" y="194" font-size="11" fill="#21447c" text-anchor="middle">커밋 2 빌드 (단독 실행)</text>
  <text x="24" y="228" font-size="10.5" fill="#21447c">동일 concurrency 그룹에 새 실행이 들어오면 이전 실행은 즉시 취소되고 자원을 곧장 넘겨받는다.</text>
</svg>
<figcaption><b>그림 4.</b> concurrency 그룹 도입 전에는 같은 브랜치의 빌드가 겹쳐 실행되며 자원을 나눠 썼다. 도입 후에는 새 커밋이 밀려오는 즉시 이전 빌드가 취소되고 최신 커밋만 단독으로 실행된다.</figcaption>
</figure>

## 최적화 전후 성능 평가 지표

이번 3가지 결합 최적화 기법을 도입한 전후의 기술적 변화 지표<sup class="fnref" id="fnref6"><a href="#fn6">6</a></sup>는 다음과 같이 요약된다.

| 평가 항목 | 개선 이전 상태 | 개선 이후 상태 | 개선 및 절감 효과 |
| :--- | :--- | :--- | :--- |
| **백엔드 도커 이미지 용량** | 2.94 GB | 212 MB | 약 92.7% 용량 절감 |
| **CI 패키지 설치 소요 시간** | 185 초 | 28 초 | 약 84.8% 속도 향상 |
| **중복 커밋 시 배포 대기 시간** | 누적 대기 (최대 10분 이상) | 즉시 취소 후 빌드 시작 (대기 없음) | 워크플로우 회전 속도 극대화 |
| **허깅페이스 모델 최초/재부팅 로드 시간** | 매번 신규 원격 다운로드 | 최초 1회 캐싱 후 무지연 즉시 참조 | 서비스 기동 안정성 확보 |

## 결론 및 향후 계획

테스트 및 빌드 파이프라인의 핵심적 비효율을 걷어냄으로써 전체 백엔드 개발자 생산성과 배포 프로세스의 신뢰도가 크게 올라갔다. 앞으로도 로컬 및 프로덕션 환경의 이미지 리포지토리 효율성을 지속적으로 관측하고 파이프라인 각 단계에서 불필요하게 낭비되는 병목 지점을 선제적으로 소거해 나갈 예정이다.

<hr>
<ol class="footnotes">
<li id="fn1">문장이나 문단을 고정 길이의 벡터로 바꿔주는 임베딩 라이브러리. 내부적으로 PyTorch와 트랜스포머 모델을 함께 내려받아 설치 용량이 크다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">Dockerfile 안에 FROM을 여러 번 선언해 빌드 단계를 분리하는 방식. 앞 스테이지의 결과물 중 필요한 파일만 COPY --from으로 다음 스테이지에 가져오고, 나머지 빌드 도구와 중간 산출물은 최종 이미지에 남지 않는다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">build-essential은 gcc 등 C/C++ 컴파일에 필요한 도구 모음, libpq-dev는 PostgreSQL 클라이언트 라이브러리의 헤더 파일이다. psycopg 등 일부 파이썬 패키지가 설치 시점에 네이티브 코드를 컴파일하기 위해 필요하다. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">Hugging Face 라이브러리가 모델 가중치와 토크나이저 파일을 내려받아 캐싱하는 경로를 지정하는 환경변수. 기본값은 컨테이너 내부의 임시 경로라 재시작하면 캐시가 사라진다. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">GitHub Actions에서 동일한 concurrency 그룹에 속한 실행이 겹치면 cancel-in-progress 설정에 따라 이전 실행을 자동으로 취소하는 워크플로 레벨 설정이다. <a class="fnback" href="#fnref5">↩</a></li>
<li id="fn6">표의 수치는 최적화 적용 전후 실제 도커 이미지 빌드 로그와 CI 설치 단계 실행 시간을 그대로 측정한 값이다. <a class="fnback" href="#fnref6">↩</a></li>
</ol>
