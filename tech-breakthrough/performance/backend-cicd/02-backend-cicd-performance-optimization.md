# CI/CD 파이프라인 속도 향상을 위한 4대 최적화 및 캐싱 전략

**작성일**: 2026-07-15

## 파이프라인 지연의 원인 분석

기존 백엔드 CI 파이프라인은 단일 잡 구조에서 모든 검증을 순차적으로 수행하였기에 병목이 심각한 상태였다. 파이프라인이 돌 때마다 가상환경을 구축하고 모든 패키지를 새로 설치하는 과정이 반복되었으며 이는 네트워크 대역폭과 시간을 낭비하는 주된 요인이었다. 특히 파이썬 정적 분석과 유닛 테스트 그리고 통합 테스트와 도커 이미지 빌드에 이르기까지 이전 단계의 성공 여부와 무관하게 모든 과정이 한 줄로 길게 연결되어 전체 실행 시간이 많이 소요되었다. 이러한 긴 피드백 주기는 개발자의 생산성을 떨어뜨리고 병합을 망설이게 만드는 장벽으로 작용하였다. 이에 따라 병목 지점을 정밀 분석하여 이를 해결하기 위한 네 가지 핵심 최적화 및 캐싱 전략을 수립하여 적용하였다.

<figure>
<svg viewBox="0 0 720 200" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="최적화 이전의 직렬 파이프라인 구조">
  <defs><marker id="s1" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#8a8d95"/></marker></defs>
  <text x="24" y="30" font-size="12" font-weight="700" fill="#8a8d95">최적화 이전 · 단일 잡 직렬 실행 (PR 빌드 #133 기준)</text>
  <g font-size="12.5">
    <rect x="24" y="60" width="140" height="52" rx="8" fill="#ffffff" stroke="#8a8d95"/>
    <text x="94" y="82" font-weight="700" fill="#5b5e66" text-anchor="middle">lint</text>
    <text x="94" y="100" font-size="10.5" fill="#8a8d95" text-anchor="middle">1분 47초</text>
    <path d="M164 86 H196" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#s1)"/>
    <rect x="200" y="60" width="140" height="52" rx="8" fill="#ffffff" stroke="#8a8d95"/>
    <text x="270" y="82" font-weight="700" fill="#5b5e66" text-anchor="middle">unit</text>
    <text x="270" y="100" font-size="10.5" fill="#8a8d95" text-anchor="middle">1분 57초</text>
    <path d="M340 86 H372" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#s1)"/>
    <rect x="376" y="60" width="140" height="52" rx="8" fill="#ffffff" stroke="#8a8d95"/>
    <text x="446" y="82" font-weight="700" fill="#5b5e66" text-anchor="middle">integration</text>
    <text x="446" y="100" font-size="10.5" fill="#8a8d95" text-anchor="middle">1분 57초</text>
    <path d="M516 86 H548" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#s1)"/>
    <rect x="552" y="60" width="144" height="52" rx="8" fill="#fbeae6" stroke="#b3402f"/>
    <text x="624" y="82" font-weight="700" fill="#b3402f" text-anchor="middle">docker-build</text>
    <text x="624" y="100" font-size="10.5" fill="#b3402f" text-anchor="middle">2분 18초</text>
  </g>
  <rect x="24" y="140" width="672" height="40" rx="9" fill="#f7f8fa" stroke="#e4e6ec"/>
  <text x="360" y="165" font-size="12" fill="#5b5e66" text-anchor="middle">네 단계가 앞 단계의 완료만 기다리며 한 줄로 이어져, 합계 6분 9초가 그대로 대기 시간이 된다.</text>
</svg>
<figcaption><b>그림 1.</b> 최적화 전 파이프라인. 서로 독립적으로 실행 가능한 unit과 docker-build조차 앞뒤로 묶여 있어, 각 단계 시간의 합이 곧 전체 대기 시간이다.</figcaption>
</figure>

## 파이프라인 지연을 유발하는 3대 병목 요인

파이프라인 속도 저하를 야기하는 첫 번째 요인은 의존성 패키지의 불필요한 반복 설치였다. 파이프라인의 각 단계가 실행될 때마다 가상환경을 매번 새로 구축하고 프로젝트에 필요한 대용량 패키지들을 네트워크를 통해 반복해서 다운로드하는 비효율이 존재하였다. 특히 파이썬 린트 검사처럼 매우 단순한 구문 분석 작업조차도 전체 개발 의존성 패키지를 모두 설치한 뒤에야 실행될 수 있었기에 초기 구동 시간이 비정상적으로 늘어났다.

두 번째 요인은 모든 검증 단계가 하나로 이어져 있는 직렬 실행 구조였다. 문법 오류를 잡는 린트 단계와 실제 데이터베이스를 활용하는 통합 테스트 그리고 도커 이미지 빌드에 이르기까지 서로 독립적으로 실행 가능한 작업들이 앞 단계의 완료만을 기다리며 순차적으로 대기하였다. 린트 검증이 끝난 직후 유닛 테스트와 도커 이미지 빌드를 동시에 돌릴 수 있는 충분한 러너 자원이 있음에도 하나의 흐름으로 묶여 있어 파이프라인 완료 시간은 각 단계의 수행 시간을 모두 더한 만큼 늘어났다.

세 번째 요인은 도커 빌드 시 레이어 캐시를 전혀 사용하지 못하는 한계였다. 깃허브 액션의 기본 빌드 환경은 매 실행마다 초기화된 상태로 시작하므로 이전 빌드에서 다운로드한 베이스 이미지나 빌드 단계별 산출물이 로컬 캐시에 남아있지 않았다. 이에 따라 소스 코드에 단 한 줄의 미미한 수정만 발생하더라도 패키지 다운로드와 컴파일을 포함한 모든 도커 빌드 레이어를 매번 처음부터 다시 빌드해야 했고 이는 최종 배포 준비 단계의 지연을 심화시키는 치명적인 요인으로 작용하였다.

## Ruff 전용 액션을 통한 린트 속도 극대화

기존에는 린트 검증을 위해 전체 가상환경을 구축하고 린트 도구와 함께 프로젝트 의존성 패키지까지 전부 설치한 후에 검사 명령을 실행하였다. 파이썬 문법 검사와 스타일 확인만 수행하면 되는 단순한 작업에 수십 초의 무거운 의존성 설치 시간이 낭비되는 비효율이 있었다. 이를 개선하기 위해 파이썬 가상환경 설치 단계를 완전히 생략하고 깃허브 액션 환경에서 제공하는 Ruff 전용 러너 액션<sup class="fnref" id="fnref1"><a href="#fn1">1</a></sup>을 적용하였다. 해당 액션은 가상환경 구성 없이 러너 자체에서 제공하는 경량 런타임을 활용하므로 불필요한 의존성 설치 단계를 건너뛴다. 그 결과 단 일 초 만에 프로젝트 코드 전체에 대한 문법 및 코드 스타일 검사를 마치고 즉각적인 피드백을 전달할 수 있게 되었다.

```yaml
# Ruff 전용 액션 적용 예시
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Run Ruff Lint Check
        uses: astral-sh/ruff-action@v1
        with:
          args: check .
```

## 가상환경 디렉터리 캐싱을 이용한 의존성 설치 생략

매번 수십 메가바이트에 달하는 외부 패키지를 새로 다운로드하고 빌드하여 설치하는 과정은 네트워크 지연과 가상환경 구성 시간을 극도로 늘리는 원인이었다. 린트 단계를 분리한 뒤에도 유닛 테스트와 통합 테스트 실행을 위해 동일한 의존성을 여러 번 설치해야 하는 중복이 존재하였다. 이 문제를 해결하기 위해 프로젝트 루트 디렉터리에 가상환경 폴더를 직접 생성하고 이를 패키지 목록 파일의 해시값을 키로 삼아 캐싱하는 구조<sup class="fnref" id="fnref2"><a href="#fn2">2</a></sup>를 고안하였다. 이렇게 가상환경 자체를 캐싱함으로써 변경 사항이 없을 때는 캐시 저장소에서 디렉터리를 그대로 복원하여 추가 설치 과정 없이 즉시 파이프라인을 다음 단계로 이행시킬 수 있게 되었다.

```yaml
# 가상환경 캐싱 설정 예시
jobs:
  setup-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Cache Virtualenv Directory
        uses: actions/cache@v4
        id: venv-cache
        with:
          path: .venv
          key: ${{ runner.os }}-venv-${{ hashFiles('requirements.txt', 'requirements-dev.txt') }}
      - name: Install Dependencies
        if: steps.venv-cache.outputs.cache-hit != 'true'
        run: |
          python -m venv .venv
          .venv/bin/pip install -r requirements.txt -r requirements-dev.txt
```

## Docker Buildx 레이어 캐싱 및 깃허브 액션 백엔드 연동

도커 이미지 빌드는 파이프라인의 최종 결과물을 만드는 중요한 단계이나 캐시가 유실되면 매번 베이스 이미지 다운로드부터 파이썬 패키지 설치와 소스 코드 복사에 이르기까지 모든 레이어를 새로 빌드해야만 한다. 깃허브 액션의 기본 러너 환경은 매 실행마다 초기화되므로 로컬 환경의 도커 엔진 캐시를 사용할 수 없다. 이 문제를 해결하기 위해 깃허브 액션 백엔드를 전용 캐시 저장소로 사용하는 Docker Buildx<sup class="fnref" id="fnref3"><a href="#fn3">3</a></sup> 캐싱 메커니즘을 연동하였다. 빌드 명령 실행 시 캐시 가져오기와 내보내기 대상을 모두 깃허브 액션 캐시 시스템(type=gha)<sup class="fnref" id="fnref4"><a href="#fn4">4</a></sup>으로 지정함으로써 이미 성공적으로 빌드된 패키지 레이어와 정적 자산 레이어를 다시 빌드하지 않고 재사용하여 이미지 생성 속도를 획기적으로 낮추었다.

<figure>
<svg viewBox="0 0 720 214" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="Docker Buildx GHA 캐시 흐름">
  <defs><marker id="s2" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker></defs>
  <rect x="24" y="20" width="672" height="70" rx="10" fill="#fafbfc" stroke="#c9ccd3" stroke-dasharray="5 4"/>
  <text x="40" y="42" font-size="12" font-weight="700" fill="#5b5e66">이전 빌드</text>
  <rect x="140" y="34" width="160" height="42" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="220" y="60" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">docker-build</text>
  <path d="M300 55 H420" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#s2)"/>
  <text x="360" y="48" font-size="10.5" fill="#21447c" text-anchor="middle">cache-to</text>
  <rect x="424" y="34" width="240" height="42" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="544" y="60" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">GitHub Actions 캐시 저장소</text>
  <rect x="24" y="122" width="672" height="70" rx="10" fill="#fafbfc" stroke="#c9ccd3" stroke-dasharray="5 4"/>
  <text x="40" y="144" font-size="12" font-weight="700" fill="#5b5e66">이번 빌드</text>
  <rect x="424" y="136" width="240" height="42" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="544" y="162" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">GitHub Actions 캐시 저장소</text>
  <path d="M420 157 H300" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#s2)"/>
  <text x="360" y="150" font-size="10.5" fill="#21447c" text-anchor="middle">cache-from</text>
  <rect x="140" y="136" width="160" height="42" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="220" y="162" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">docker-build</text>
</svg>
<figcaption><b>그림 2.</b> Buildx GHA 캐시 흐름. 이전 빌드가 내보낸(cache-to) 레이어를 이번 빌드가 그대로 가져와(cache-from), 바뀌지 않은 레이어는 다시 빌드하지 않는다.</figcaption>
</figure>

```yaml
# Docker Buildx 레이어 캐싱 예시
jobs:
  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3
      - name: Build and Push with Cache
        uses: docker/build-push-action@v5
        with:
          context: .
          push: false
          tags: career-backend:ci
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

## 작업 병렬화를 통한 순차 지연 제거

기존 파이프라인은 모든 유닛 테스트가 끝난 다음에야 도커 빌드가 수행되도록 단계가 수직으로 연결되어 있었다. 도커 빌드는 작성된 파이썬 애플리케이션 코드를 포함한 격리 환경을 구성하는 작업이므로 실제 내부 단위 테스트의 성공 여부와 독립적으로 진행할 수 있다. 이에 따라 서로 종속성이 없는 단위 테스트 작업과 도커 이미지 빌드 작업을 동시에 수행하도록 병렬 실행 구조로 재편하였다. 린트 검증을 통과한 즉시 유닛 테스트와 도커 빌드가 서로 다른 러너 인스턴스에서 분기하여 함께 가동되므로 물리적인 병목 대기 시간이 줄어들었다. 또한 상대적으로 수행 시간이 긴 통합 테스트는 가벼운 유닛 테스트가 통과된 시점에만 트리거되도록 needs<sup class="fnref" id="fnref5"><a href="#fn5">5</a></sup>로 조정하여 불필요한 인프라 리소스 소모를 방지하였다.

<figure>
<svg viewBox="0 0 720 216" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:auto;font-family:'Pretendard',-apple-system,'Segoe UI',sans-serif" role="img" aria-label="병렬화 이후 파이프라인 구조">
  <defs><marker id="s3" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0 0 L7 3 L0 6 z" fill="#21447c"/></marker></defs>
  <text x="24" y="28" font-size="12" font-weight="700" fill="#21447c">최적화 후 · 병렬 실행 구조</text>
  <rect x="24" y="80" width="112" height="48" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="80" y="109" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">lint</text>
  <path d="M136 88 C160 88 168 56 188 54" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#s3)"/>
  <path d="M136 120 C160 120 168 152 188 154" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#s3)"/>
  <rect x="192" y="30" width="128" height="48" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="256" y="59" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">unit</text>
  <rect x="192" y="130" width="128" height="48" rx="8" fill="#eef2f9" stroke="#21447c"/>
  <text x="256" y="159" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">docker-build</text>
  <rect x="176" y="14" width="160" height="176" rx="12" fill="none" stroke="#21447c" stroke-dasharray="4 4"/>
  <text x="256" y="204" font-size="10.5" fill="#21447c" text-anchor="middle">needs: lint (동시 실행)</text>
  <path d="M320 54 C348 54 356 54 380 54" fill="none" stroke="#21447c" stroke-width="1.6" marker-end="url(#s3)"/>
  <rect x="384" y="30" width="140" height="48" rx="8" fill="#ffffff" stroke="#21447c"/>
  <text x="454" y="59" font-size="12.5" font-weight="700" fill="#21447c" text-anchor="middle">integration</text>
  <text x="454" y="72" font-size="10" fill="#8a8d95" text-anchor="middle">needs: unit</text>
  <path d="M524 54 H556" fill="none" stroke="#8a8d95" stroke-width="1.5" marker-end="url(#s3)"/>
  <rect x="560" y="30" width="136" height="48" rx="8" fill="#f7f8fa" stroke="#8a8d95" stroke-dasharray="3 3"/>
  <text x="628" y="59" font-size="11.5" fill="#5b5e66" text-anchor="middle">deploy 준비 완료</text>
</svg>
<figcaption><b>그림 3.</b> 병렬화 후 구조. lint 하나만 통과하면 unit과 docker-build가 동시에 시작되고, integration은 unit 완료만 기다린다. 구체적인 개선 시간은 프로덕션 실행 후 갱신할 예정이다.</figcaption>
</figure>

```yaml
# 병렬 워크플로 및 종속성 구성 예시
jobs:
  lint:
    runs-on: ubuntu-latest
    # ...
  unit:
    needs: lint
    runs-on: ubuntu-latest
    # ...
  docker-build:
    needs: lint
    runs-on: ubuntu-latest
    # ...
  integration:
    needs: unit
    runs-on: ubuntu-latest
    # ...
```

## 최적화 전후 성능 지표 비교

네 가지 최적화 기법을 적용하기 전의 실제 빌드 이력 데이터<sup class="fnref" id="fnref6"><a href="#fn6">6</a></sup>와 최적화 이후의 실측 성능 지표를 비교한 결과는 다음과 같다. Push 배포 워크플로우 쪽은 이 문서의 네 가지 기법에 이어 03번 문서의 추가 튜닝까지 모두 main에 반영된 뒤 실제로 트리거된 배포 실행<sup class="fnref" id="fnref7"><a href="#fn7">7</a></sup>의 결과로 채워 넣었다. 이 실행이 각 단계에서 왜 그런 시간이 나왔는지에 대한 자세한 해설은 04번 문서에서 다룬다. PR 기준 CI 워크플로우 쪽은 아직 그런 실측 기회가 없어 측정 예정으로 남겨 둔다.

### CI 워크플로우 (PR 빌드 기준)

| 파이프라인 단계 | 최적화 전 소요 시간 (이전 #133 빌드) | 최적화 후 소요 시간 | 적용된 주요 최적화 기법 |
| :--- | :--- | :--- | :--- |
| 린트 검사 (`test / lint`) | 1분 47초 | 측정 예정 | Ruff 전용 깃허브 액션 도입 |
| 단위 테스트 (`test / unit`) | 1분 57초 | 측정 예정 | Virtualenv 폴더 캐싱 구성 |
| 통합 테스트 (`test / integration`) | 1분 57초 | 측정 예정 | 데이터베이스 부트스트랩 최적화 |
| 도커 빌드 (`test / docker-build`) | 2분 18초 | 측정 예정 | Docker Buildx GHA 레이어 캐싱 |
| **총 소요 시간** | **6분 9초** | **측정 예정** | **작업 병렬화 및 캐싱 시스템 도입** |

### Deploy 워크플로우 (Push 배포 기준)

| 파이프라인 단계 | 최적화 전 소요 시간 (이전 #72 빌드) | 최적화 후 소요 시간 (실측 #85 빌드) | 개선율 | 적용된 주요 최적화 기법 |
| :--- | :--- | :--- | :--- | :--- |
| 린트 검사 (`test / lint`) | 1분 48초 | 8초 | 약 92.6% 단축 | Ruff 전용 깃허브 액션 도입 |
| 단위 테스트 (`test / unit`) | 2분 23초 | 17초 | 약 88.1% 단축 | Virtualenv 폴더 캐싱 구성 |
| 통합 테스트 (`test / integration`) | 2분 25초 | 33초 | 약 77.2% 단축 | Virtualenv 폴더 캐싱 구성 |
| 도커 빌드 (`test / docker-build`) | 1분 32초 | 59초 | 약 35.9% 단축 | Docker Buildx GHA 레이어 캐싱 |
| 프로덕션 배포 (`deploy`) | 9분 11초 | 1분 25초 | 약 84.6% 단축 | 배포 파이프라인 안정화 및 03번 문서의 이미지 경량화 |
| **총 소요 시간(워크플로 전체)** | **15분 58초** | **2분 50초** | **약 82.3% 단축** | **작업 병렬화 및 캐싱 시스템 도입** |

이와 같은 성능 향상 덕분에 풀 리퀘스트를 생성할 때마다 소요되던 개발자의 대기 시간이 대폭 축소되었다. 이는 커밋 검증의 부담을 경감시키고 지속적 통합의 가치를 극대화하여 전체 팀의 개발 리듬을 민첩하게 유지하는 강력한 기술적 기반이 되었다. 실측치가 예측을 벗어나지 않았다는 점, 특히 도커 빌드 단계만은 다른 단계만큼 극적으로 줄지 않았다는 점까지 포함해 왜 그런 결과가 나왔는지는 04번 문서에서 단계별로 풀어 쓴다.

<hr>
<ol class="footnotes">
<li id="fn1">astral-sh/ruff-action. 러너에 사전 컴파일된 Ruff 바이너리를 받아 실행하는 전용 액션으로, 파이썬 가상환경 구축이나 의존성 설치 없이 린트만 수행한다. <a class="fnback" href="#fnref1">↩</a></li>
<li id="fn2">actions/cache의 key에 hashFiles()로 requirements 파일의 내용 해시를 넣는 방식. 파일 내용이 바뀌지 않으면 동일한 키로 이전 캐시를 그대로 복원해 설치 단계를 건너뛴다. <a class="fnback" href="#fnref2">↩</a></li>
<li id="fn3">BuildKit 기반의 확장 도커 빌더. 멀티 플랫폼 빌드와 원격 캐시 백엔드 지정 등 기본 도커 빌드에 없는 기능을 제공한다. <a class="fnback" href="#fnref3">↩</a></li>
<li id="fn4">cache-from/cache-to에 지정하는 캐시 백엔드 종류. type=gha는 GitHub Actions가 제공하는 캐시 저장소를 레이어 캐시 저장소로 쓴다는 뜻이다. <a class="fnback" href="#fnref4">↩</a></li>
<li id="fn5">GitHub Actions에서 잡 사이의 의존 관계를 선언하는 키워드. needs를 걸지 않은 잡끼리는 기본적으로 병렬 실행된다. <a class="fnback" href="#fnref5">↩</a></li>
<li id="fn6">표에 인용된 최적화 전 수치는 실제 GitHub Actions 실행 로그(CI는 #133, Deploy는 #72)의 잡별 소요 시간을 그대로 옮긴 값이다. <a class="fnback" href="#fnref6">↩</a></li>
<li id="fn7">main 브랜치 push로 트리거된 배포 워크플로 실행 #85(run ID 29433122162, 커밋 f6fa5c3). <a class="fnback" href="#fnref7">↩</a></li>
</ol>
