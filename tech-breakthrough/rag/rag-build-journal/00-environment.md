# 환경 세팅: 하드웨어부터 기록 규칙까지

## 개요

이 문서는 구현기 트랙의 첫 번째 문서다. 개념서가 RAG의 원리를 설명하는 트랙이라면, 구현기는 실제로 무엇을 어떤 환경에서 어떻게 했는지를 실측으로 남기는 트랙이다. 처음 작성할 때는 구현 이전이라 값이 비어 있었지만, 수집과 마트화와 임베딩과 적재를 모두 마친 지금은 그 자리를 실제 값으로 채운다. 아래 수치는 이후 문서에 나오는 모든 성능 수치를 해석하는 기준이 된다.

## 작업 환경의 큰 그림

이 프로젝트의 환경은 두 곳으로 나뉜다. 무거운 계산은 로컬 개발 PC의 GPU에서 하고, 프로덕션에는 그 결과물만 올려 서빙한다. 수집과 추출과 임베딩처럼 CPU나 GPU를 오래 쓰는 작업은 로컬에서 처리하고, GCP에는 완성된 데이터와 앱만 둔다. 이렇게 나눈 이유는 GPU가 필요한 임베딩을 클라우드에서 돌리면 비용이 크게 늘기 때문이다.

<svg viewBox="0 0 720 300" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<rect x="8" y="20" width="330" height="260" rx="8" fill="#f8fafc" stroke="#94a3b8"/>
<text x="24" y="42" fill="#334155" font-size="13">로컬 개발 PC (Fedora 44)</text>
<rect x="28" y="58" width="290" height="46" rx="6" fill="#f0fdf4" stroke="#16a34a"/>
<text x="44" y="78" fill="#166534">RTX 4060 8GB</text>
<text x="44" y="95" fill="#16a34a" font-size="10">BGE-M3 임베딩 생성 (GPU FP16)</text>
<rect x="28" y="114" width="290" height="46" rx="6" fill="#eef2ff" stroke="#6366f1"/>
<text x="44" y="134" fill="#3730a3">16코어 CPU / 46GB RAM</text>
<text x="44" y="151" fill="#6366f1" font-size="10">수집, 추출, 마트화 (14프로세스 병렬)</text>
<rect x="28" y="170" width="290" height="46" rx="6" fill="#ecfeff" stroke="#0891b2"/>
<text x="44" y="190" fill="#155e75">mart.db + embeddings.db</text>
<text x="44" y="207" fill="#0891b2" font-size="10">완성된 데이터 산출물</text>
<text x="173" y="250" text-anchor="middle" fill="#64748b" font-size="11">무거운 계산은 전부 여기서</text>
<line x1="338" y1="193" x2="382" y2="193" stroke="#475569" stroke-width="2"/>
<text x="360" y="185" text-anchor="middle" fill="#475569" font-size="10">GCS</text>
<polygon points="382,193 374,189 374,197" fill="#475569"/>
<rect x="382" y="20" width="330" height="260" rx="8" fill="#f8fafc" stroke="#94a3b8"/>
<text x="398" y="42" fill="#334155" font-size="13">GCP (asia-northeast3)</text>
<rect x="402" y="58" width="290" height="70" rx="6" fill="#fef2f2" stroke="#dc2626"/>
<text x="418" y="78" fill="#991b1b">Cloud SQL (Postgres 17 + pgvector)</text>
<text x="418" y="95" fill="#dc2626" font-size="10">공고 56.5만 + 벡터 56.5만</text>
<text x="418" y="112" fill="#dc2626" font-size="10">db-custom-1-3840</text>
<rect x="402" y="138" width="290" height="82" rx="6" fill="#fefce8" stroke="#ca8a04"/>
<text x="418" y="158" fill="#854d0e">GCE VM (e2-standard-2)</text>
<text x="418" y="175" fill="#ca8a04" font-size="10">FastAPI app + RAG</text>
<text x="418" y="191" fill="#ca8a04" font-size="10">Traefik (HTTPS) + 관측성 스택</text>
<text x="418" y="207" fill="#ca8a04" font-size="10">Grafana, Prometheus, Loki, Tempo</text>
<line x1="547" y1="128" x2="547" y2="138" stroke="#475569" stroke-width="2"/>
<polygon points="547,138 543,130 551,130" fill="#475569"/>
<text x="620" y="250" text-anchor="middle" fill="#64748b" font-size="11">데이터와 앱만 서빙</text>
</svg>

## 하드웨어

로컬 임베딩과 리랭커를 자체 호스팅하기로 했기 때문에, GPU와 메모리 사양이 임베딩 성능을 해석하는 기준이 된다.

| 항목 | 값 |
|---|---|
| GPU | NVIDIA GeForce RTX 4060, VRAM 8GB (8188 MiB) |
| GPU 드라이버 | 595.80 |
| CPU | 16 코어 |
| RAM | 46 GB (공칭 48GB) |
| OS | Fedora Linux 44 Workstation, 커널 7.0.14 |

VRAM이 8GB로 넉넉하지 않은 점이 임베딩 설계에 직접 영향을 줬다. BGE-M3의 dense 출력만 쓰고 FP16으로 낮춘 것도 이 8GB 한도 안에서 배치를 키우기 위한 선택이었다. 실제 임베딩 때 VRAM은 약 6GB를 썼고, 자세한 실측은 07 문서에 있다.

## 소프트웨어 스택

로컬과 프로덕션의 런타임이 다르다는 점이 중요하다. 로컬 개발 파이썬과 배포 컨테이너 파이썬의 버전이 다르므로, 버전에 민감한 코드는 양쪽에서 확인했다.

| 항목 | 값 |
|---|---|
| PostgreSQL | 17.5 (Debian) |
| pgvector | 0.8.4 |
| 로컬 파이썬 | 3.14.6 |
| 배포 컨테이너 파이썬 | 3.12 (python:3.12-slim) |
| SQLAlchemy | 2.0.51 |
| psycopg | 3.2.13 (psycopg3) |
| 임베딩 스택 | sentence-transformers + torch (CUDA), 별도 venv에서 실행 |
| 쿼리 임베딩(프로덕션) | fastembed onnx, 기능 플래그로 게이팅 |

pgvector 0.8.4는 벡터 차원 1024를 담는 `vector(1024)` 컬럼과 코사인 거리 연산자를 제공한다. 이 버전과 차원이 맞지 않으면 적재 자체가 실패하기 때문에, 임베딩을 만들기 전에 차원 버그부터 잡았다. 그 전말은 02 문서에 있다.

## 프로덕션 인프라

프로덕션은 GCP의 서울 리전에서 돈다. 앞의 그림에서 오른쪽에 해당하는 부분이다.

| 구성 | 값 |
|---|---|
| GCE VM | 배포 VM, e2-standard-2 (2 vCPU / 8GB), 디스크 30GB |
| Cloud SQL | 관리형 Postgres 인스턴스, db-custom-1-3840 (1 vCPU / 3.75GB), 10GB SSD, 프라이빗 IP |
| 리버스 프록시 | Traefik v3, Let's Encrypt 자동 TLS |
| 관측성 | Prometheus, Loki, Tempo, Grafana, Alloy |
| 배포 | main 푸시 시 GitHub Actions가 이미지 빌드 후 VM에 배포 |
| 도메인 | 프로덕션 도메인 (HTTPS) |

Cloud SQL이 프라이빗 IP만 가진 점이 적재 방식을 결정했다. 로컬에서 직접 붙을 수 없어서 GCS를 경유한 서버사이드 import로 벡터를 올렸고, 그 과정은 05 문서에 있다.

## 임베딩 실행 환경 실측

임베딩은 로컬 RTX 4060에서 실행했다. BGE-M3의 dense 출력만 FP16으로 뽑아 VRAM 약 6GB 안에서 배치를 키웠고, 공고 565,191건을 약 12분에 처리해 초당 약 785건의 처리량을 냈다. 입력을 본문 대신 정제한 필드 조합으로 짧게 만든 것이 토큰 수를 줄여 이 속도를 가능하게 했다. 구체적인 수치와 그림은 07 문서에서 다룬다.

## 앞으로 채울 것

일부 항목은 후속 증분에서 실측과 함께 채운다.

- pgvector HNSW 인덱스 파라미터. 현재는 벡터 검색을 기능 플래그로만 열어 둔 상태라, 인덱스의 `m`과 `ef_construction`과 `ef_search` 값 및 빌드 시간과 쿼리 지연은 벡터 검색을 프로덕션에서 켜는 시점에 측정한다.
- 그래프 커뮤니티 검출 파라미터. 지금은 그래프 도구가 공동출현 순회만 하므로, 커뮤니티 검출의 해상도와 클러스터 개수는 global search를 구현하는 증분에서 채운다.
- 에이전트 토큰과 비용. Gemini 라우터와 합성의 질의당 토큰과 비용은 프로덕션 사용 로그가 쌓이면 실측으로 남긴다.

## 기록 규칙

이 프로젝트는 개념만 이해하고 끝내지 않고 실전 기록까지 남긴다는 원칙을 지킨다. 이를 위해 각 구현 단계마다 세 가지를 함께 진행한다. 첫째로 그 단계에서 무엇을 왜 그렇게 결정했는지를 대화로 정리하고, 둘째로 개념서에 새로 등장한 개념이나 정정할 내용을 반영하며, 셋째로 구현기에 그 단계의 실측치와 삽질 로그를 남긴다.

세 가지를 한 단계 안에서 함께 진행하는 데는 이유가 있다. 시간이 지난 뒤 몰아서 기록하면 실측값과 판단 근거를 정확히 재구성하기 어렵고, 작업 직후 기억이 생생할 때 기록해야만 구현기가 다시 참조할 가치를 가지기 때문이다.
