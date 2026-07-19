# 데이터 벡터화 심화: 과정과 시각화

이 문서는 공고 56만 건을 실제로 벡터화한 과정을 실측 수치와 그림으로 정리한다. 앞의 02 문서가 계획이었다면, 이 문서는 그 계획을 실행한 결과이자 그 사이에 내린 판단의 기록이다. 벡터화는 RAG의 의미 검색이 딛고 서는 바닥이라, 무엇을 어떻게 벡터로 만들었는지가 검색 품질을 그대로 좌우한다.

## 1. 벡터화의 정의

벡터화는 사람이 읽는 문장을 기계가 거리로 비교할 수 있는 숫자 배열로 바꾸는 일이다. 공고 하나를 1024개의 실수로 이루어진 점 하나로 만들고, 의미가 가까운 공고끼리는 그 점들이 가까이 모이도록 배치한다. 그러면 질문도 같은 방식으로 점으로 만들어, 질문 점에서 가까운 공고 점을 찾는 것으로 의미 검색이 된다.

<svg viewBox="0 0 720 150" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<rect x="8" y="40" width="150" height="60" rx="6" fill="#eef2ff" stroke="#6366f1"/>
<text x="83" y="66" text-anchor="middle" fill="#3730a3">공고 원본 필드</text>
<text x="83" y="84" text-anchor="middle" fill="#6366f1" font-size="10">제목 업종 기술 개념</text>
<text x="185" y="74" fill="#6366f1">→</text>
<rect x="205" y="40" width="140" height="60" rx="6" fill="#ecfeff" stroke="#0891b2"/>
<text x="275" y="66" text-anchor="middle" fill="#155e75">입력 텍스트 조합</text>
<text x="275" y="84" text-anchor="middle" fill="#0891b2" font-size="10">한 문장으로 합침</text>
<text x="372" y="74" fill="#0891b2">→</text>
<rect x="392" y="40" width="150" height="60" rx="6" fill="#f0fdf4" stroke="#16a34a"/>
<text x="467" y="62" text-anchor="middle" fill="#166534">BGE-M3</text>
<text x="467" y="80" text-anchor="middle" fill="#16a34a" font-size="10">GPU FP16 dense</text>
<text x="467" y="94" text-anchor="middle" fill="#16a34a" font-size="10">1024차원 정규화</text>
<text x="569" y="74" fill="#16a34a">→</text>
<rect x="589" y="40" width="122" height="60" rx="6" fill="#fef2f2" stroke="#dc2626"/>
<text x="650" y="66" text-anchor="middle" fill="#991b1b">pgvector</text>
<text x="650" y="84" text-anchor="middle" fill="#dc2626" font-size="10">코사인 검색</text>
<text x="360" y="130" text-anchor="middle" fill="#64748b" font-size="11">무거운 계산은 로컬 GPU에서, 프로덕션에는 완성된 벡터만 싣는다</text>
</svg>

## 2. 벡터화 대상

가장 먼저 정한 것은 임베딩의 입력이었다. 흔히 공고 본문을 통째로 넣지만 우리는 그렇게 하지 않았다. 이유가 두 가지였다.

첫째는 노이즈였다. 한 국내 소스의 옛 페이지는 본문에 사이트 네비게이션 메뉴가 통째로 섞여 들어와서, 본문을 그대로 임베딩하면 채용 내용이 아니라 사이트 메뉴가 벡터에 반영되는 문제가 있었다. 이 오염은 매칭 지옥 문서에서 다룬 그 크롬 유입과 같은 뿌리였다.

둘째는 소스 간 불균형이었다. 공고 출처가 일곱 곳인데 본문의 길이와 형식이 제각각이라, 본문을 그대로 쓰면 소스마다 벡터의 성격이 달라져 검색이 한쪽으로 쏠린다.

그래서 본문 대신 마트에서 이미 정제한 필드를 조합해 입력을 만들었다. 제목과 업종에 더해, 규칙 기반으로 추출한 기술 태그와 개념 태그를 한 문장으로 엮었다. 이렇게 하면 크롬 노이즈가 원천적으로 들어올 수 없고 일곱 소스가 같은 형식을 갖는다.

```
입력 = 제목 + " " + 업종 + " 기술: " + 기술목록 + " 개념: " + 개념목록
예시 = "백엔드 개발자 금융IT 기술: Java, Spring, AWS 개념: MSA, 대규모 트래픽"
```

이 결정은 벡터화에서 가장 중요한 판단이었다. 임베딩 모델을 무엇으로 쓰느냐보다, 그 모델에 무엇을 먹이느냐가 검색 품질을 더 크게 갈랐기 때문이다.

## 3. 임베딩 실행 실측

모델은 BGE-M3의 dense 출력만 썼다. BGE-M3는 dense와 sparse와 colbert 세 가지 출력을 내지만, pgvector에 필요한 것은 dense 하나뿐이라 나머지는 끄고 속도를 확보했다. 정밀도는 FP16으로 낮춰 VRAM 8GB 한도 안에서 배치를 키웠다.

| 항목 | 값 |
|---|---|
| 대상 공고 | 565,191건 |
| 모델 | BAAI/bge-m3 (dense only) |
| 벡터 차원 | 1024 |
| 정규화 | L2 정규화 (코사인용) |
| 저장 형식 | float32, 벡터당 4096 바이트 |
| 전체 벡터 크기 | 약 2.3 GB |
| 장비 | RTX 4060 8GB, FP16 |
| VRAM 사용 | 약 6 GB / 8 GB |
| 처리 속도 | 약 785건/초 |
| 총 소요 | 약 12분 |

계획 단계에서는 1시간에서 2.5시간을 예상했는데, 실제로는 12분에 끝났다. 본문을 넣지 않고 조합한 짧은 텍스트를 입력으로 썼기 때문에 토큰 수가 줄어 배치를 크게 잡을 수 있었던 덕이다. 무엇을 벡터로 만들 것인가의 결정이 속도에도 그대로 이어진 셈이다.

## 4. 코사인 유사도 검색

정규화한 벡터끼리는 코사인 유사도로 가까움을 잰다. 두 벡터가 이루는 각이 좁을수록 유사도가 1에 가깝고, 직각이면 0이다. pgvector에서는 코사인 거리 연산자로 가장 가까운 벡터를 정렬해 top-k를 뽑는다.

<svg viewBox="0 0 720 190" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<circle cx="150" cy="120" r="4" fill="#334155"/>
<text x="150" y="145" text-anchor="middle" fill="#64748b">원점</text>
<line x1="150" y1="120" x2="150" y2="30" stroke="#16a34a" stroke-width="2"/>
<text x="150" y="24" text-anchor="middle" fill="#166534">공고 A</text>
<line x1="150" y1="120" x2="230" y2="55" stroke="#0891b2" stroke-width="2"/>
<text x="245" y="52" fill="#155e75">공고 B</text>
<path d="M 150 80 A 40 40 0 0 1 176 90" fill="none" stroke="#94a3b8"/>
<text x="196" y="86" fill="#64748b" font-size="11">좁은 각 = 유사도 높음</text>
<line x1="150" y1="120" x2="420" y2="120" stroke="#dc2626" stroke-width="2"/>
<text x="430" y="124" fill="#991b1b">공고 C</text>
<text x="300" y="150" fill="#64748b" font-size="11">직각에 가까울수록 유사도 0에 수렴</text>
<text x="560" y="70" fill="#334155" font-size="13">유사도 = cos(각)</text>
<text x="560" y="92" fill="#64748b" font-size="11">A와 B는 가깝고</text>
<text x="560" y="110" fill="#64748b" font-size="11">A와 C는 멀다</text>
</svg>

## 5. 의미 검색 검증

벡터가 제대로 만들어졌는지는 최근접 이웃을 눈으로 확인하는 것으로 검증했다. 특정 공고를 골라 그와 코사인이 가장 가까운 공고들을 뽑아봤을 때, 단어가 겹치지 않아도 의미가 통하는 공고가 올라오면 성공이다.

| 기준 공고 | 가장 가까운 이웃 | 코사인 |
|---|---|---|
| EV충전 백엔드 개발자 | 전기차 충전 백엔드 개발자 | 0.84 |
| 머신러닝 엔지니어 | 인공지능 머신러닝 개발자 | 0.87 |
| 머신러닝 엔지니어 | ML Engineer | 0.86 |
| React Native 앱 개발자 | Mobile App Developer (React Native) | 0.87 |

EV충전과 전기차충전은 글자가 다르지만 같은 뜻인데, 벡터는 이 둘을 0.84로 가깝게 놓았다. 규칙 기반 문자열 매칭으로는 절대 잡을 수 없는 연결을 임베딩이 잡아낸 것이다. 이것이 규칙 매칭 위에 벡터 검색을 얹는 이유다.

## 6. 데이터 분포

벡터화의 입력이 된 기술 태그와 개념 태그가 실제로 어떻게 분포하는지도 함께 본다. 아래는 전체 565,191건 공고에서 가장 많이 요구된 기술이다.

<svg viewBox="0 0 720 250" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="18" fill="#334155" font-size="13">수요 상위 기술 (공고 수)</text>
<g fill="#334155" text-anchor="end"><text x="86" y="46">Python</text><text x="86" y="72">JavaScript</text><text x="86" y="98">AWS</text><text x="86" y="124">Java</text><text x="86" y="150">Git</text><text x="86" y="176">SQL</text><text x="86" y="202">Linux</text><text x="86" y="228">Azure</text></g>
<g fill="#6366f1"><rect x="94" y="34" width="320" height="16" rx="3"/><rect x="94" y="60" width="300" height="16" rx="3"/><rect x="94" y="86" width="279" height="16" rx="3"/><rect x="94" y="112" width="264" height="16" rx="3"/><rect x="94" y="138" width="235" height="16" rx="3"/><rect x="94" y="164" width="188" height="16" rx="3"/><rect x="94" y="190" width="157" height="16" rx="3"/><rect x="94" y="216" width="133" height="16" rx="3"/></g>
<g fill="#475569" font-size="11"><text x="420" y="46">24,494</text><text x="400" y="72">22,968</text><text x="379" y="98">21,327</text><text x="364" y="124">20,172</text><text x="335" y="150">18,005</text><text x="288" y="176">14,376</text><text x="257" y="202">12,040</text><text x="233" y="228">10,201</text></g>
</svg>

개념 축은 기술과 다른 신호를 준다. 기술이 무엇을 다루는지를 말한다면 개념은 어떻게 일하는지를 말한다. 아래는 개념 태그의 분포다.

<svg viewBox="0 0 720 250" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="18" fill="#334155" font-size="13">빈출 개념 (공고 수)</text>
<g fill="#334155" text-anchor="end"><text x="118" y="46">개인정보 컴플라이언스</text><text x="118" y="72">확장성 성능</text><text x="118" y="98">CI/CD 자동화</text><text x="118" y="124">애자일 협업</text><text x="118" y="150">DevOps</text><text x="118" y="176">생성형 AI LLM</text><text x="118" y="202">머신러닝 딥러닝</text><text x="118" y="228">테스트 품질</text></g>
<g fill="#0891b2"><rect x="126" y="34" width="320" height="16" rx="3"/><rect x="126" y="60" width="192" height="16" rx="3"/><rect x="126" y="86" width="176" height="16" rx="3"/><rect x="126" y="112" width="171" height="16" rx="3"/><rect x="126" y="138" width="150" height="16" rx="3"/><rect x="126" y="164" width="124" height="16" rx="3"/><rect x="126" y="190" width="119" height="16" rx="3"/><rect x="126" y="216" width="115" height="16" rx="3"/></g>
<g fill="#475569" font-size="11"><text x="452" y="46">27,177</text><text x="324" y="72">16,304</text><text x="308" y="98">14,926</text><text x="303" y="124">14,527</text><text x="282" y="150">12,734</text><text x="256" y="176">10,543</text><text x="251" y="202">10,083</text><text x="247" y="228">9,749</text></g>
</svg>

## 7. 벡터를 프로덕션으로 옮기기

로컬에서 만든 벡터를 프로덕션 Postgres로 옮기는 단계에서 한 가지 실무 문제를 만났다. 565,191개의 벡터를 한꺼번에 파이썬 리스트로 메모리에 올리면 수 기가바이트가 되어 터진다. 그래서 float32 BLOB을 1000건씩 끊어 pgvector 컬럼에 흘려 넣는 스트리밍 방식으로 적재했다. 이 적재의 전말은 05 문서에서 다룬다.

<svg viewBox="0 0 720 120" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<rect x="8" y="35" width="150" height="50" rx="6" fill="#f0fdf4" stroke="#16a34a"/>
<text x="83" y="56" text-anchor="middle" fill="#166534">embeddings.db</text>
<text x="83" y="74" text-anchor="middle" fill="#16a34a" font-size="10">float32 BLOB</text>
<text x="170" y="64" fill="#16a34a">→</text>
<rect x="190" y="35" width="170" height="50" rx="6" fill="#fefce8" stroke="#ca8a04"/>
<text x="275" y="56" text-anchor="middle" fill="#854d0e">1000건씩 청크</text>
<text x="275" y="74" text-anchor="middle" fill="#ca8a04" font-size="10">메모리 초과 방지</text>
<text x="372" y="64" fill="#ca8a04">→</text>
<rect x="392" y="35" width="150" height="50" rx="6" fill="#eff6ff" stroke="#2563eb"/>
<text x="467" y="56" text-anchor="middle" fill="#1e40af">GCS 경유 import</text>
<text x="467" y="74" text-anchor="middle" fill="#2563eb" font-size="10">프라이빗 IP 우회</text>
<text x="554" y="64" fill="#2563eb">→</text>
<rect x="574" y="35" width="138" height="50" rx="6" fill="#fef2f2" stroke="#dc2626"/>
<text x="643" y="56" text-anchor="middle" fill="#991b1b">Cloud SQL</text>
<text x="643" y="74" text-anchor="middle" fill="#dc2626" font-size="10">vector(1024)</text>
</svg>

## 8. 정리

벡터화에서 배운 핵심은 두 가지다. 첫째, 임베딩의 품질은 모델 선택보다 입력 설계에서 결정된다. 본문을 그대로 넣는 대신 정제한 필드를 조합해 노이즈를 막고 소스를 통일한 것이 가장 중요한 판단이었다. 둘째, 규칙 매칭과 벡터 검색은 경쟁이 아니라 보완이다. 규칙은 정확하지만 글자가 달라지면 놓치고, 벡터는 의미로 연결하지만 정확한 수치는 못 낸다. 그래서 RAG에서는 정량은 규칙과 SQL이 맡고 의미 연결은 벡터가 맡도록 역할을 나눴다.
