# 고급 검색: 임베딩 학습, 하이브리드, 리랭킹, 인덱스 튜닝

## 개요

이 문서는 앞의 `02-embeddings-vectordb.md`가 다룬 임베딩과 벡터 검색의 기본 위에, 실제 검색 품질을 끌어올릴 때 쓰는 네 가지 기법을 초보자 눈높이로 설명한다. 첫째로 임베딩 모델이 애초에 어떻게 학습되는지를 조금 더 깊이 보고, 둘째로 키워드 검색과 의미 검색을 합치는 하이브리드 검색을 다루며, 셋째로 검색 결과를 다시 정렬하는 리랭킹을 설명하고, 넷째로 벡터 인덱스인 HNSW의 파라미터를 어떻게 조율하는지 정리한다. 각 절은 개념을 먼저 직관으로 잡은 다음, 코드와 그림으로 구체화한다.

## 1. 임베딩 학습 방식

`02` 문서에서 임베딩은 의미가 가까운 문장을 가까운 벡터로 만든다고 했다. 그런데 모델은 무엇이 가깝고 무엇이 먼지를 어떻게 배울까. 답은 대조학습이라 불리는 방식이다.

대조학습의 핵심은 당겨야 할 쌍과 밀어내야 할 쌍을 모델에게 보여주고, 당길 것은 가깝게 밀 것은 멀게 되도록 벡터를 조정하는 것이다[1]. 서로 의미가 통하는 두 문장을 양성 쌍이라 부르고, 관계가 없는 문장을 음성이라 부른다. 학습은 양성 쌍의 벡터 거리는 줄이고 음성과의 거리는 늘리는 방향으로 진행된다[2].

여기서 음성을 어떻게 구하느냐가 효율을 좌우한다. 가장 널리 쓰는 방법이 배치 내 음성이다. 한 번에 M개의 예시를 묶어 학습할 때, 각 예시의 진짜 짝만 양성으로 두고 같은 배치의 나머지 M에서 1을 뺀 예시를 전부 음성으로 재사용하는 것이다[2]. 음성을 따로 만들 필요 없이 배치 안에서 공짜로 얻으므로 계산이 매우 효율적이다. 여기에 더해, 겉보기에는 질문과 비슷하지만 실제로는 답이 아닌 까다로운 예시를 일부러 골라 넣기도 하는데 이를 하드 네거티브라 부른다. 쉬운 음성만으로는 모델이 대충 구분해도 통과하지만, 헷갈리는 음성을 섞으면 미세한 의미 차이까지 배우도록 강제된다[1].

<svg viewBox="0 0 720 220" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="20" fill="#334155" font-size="13">대조학습: 양성은 당기고 음성은 민다</text>
<text x="120" y="48" text-anchor="middle" fill="#64748b" font-size="11">학습 전</text>
<circle cx="120" cy="110" r="6" fill="#dc2626"/>
<text x="120" y="100" text-anchor="middle" fill="#991b1b" font-size="10">기준</text>
<circle cx="185" cy="80" r="6" fill="#16a34a"/>
<text x="200" y="80" fill="#166534" font-size="10">양성</text>
<circle cx="70" cy="150" r="6" fill="#6366f1"/>
<circle cx="180" cy="160" r="6" fill="#6366f1"/>
<text x="150" y="185" text-anchor="middle" fill="#6366f1" font-size="10">음성들이 뒤섞여 있음</text>
<text x="360" y="110" fill="#94a3b8" font-size="20">→</text>
<text x="560" y="48" text-anchor="middle" fill="#64748b" font-size="11">학습 후</text>
<circle cx="560" cy="110" r="6" fill="#dc2626"/>
<text x="560" y="100" text-anchor="middle" fill="#991b1b" font-size="10">기준</text>
<circle cx="575" cy="95" r="6" fill="#16a34a"/>
<text x="592" y="92" fill="#166534" font-size="10">양성(붙음)</text>
<circle cx="470" cy="170" r="6" fill="#6366f1"/>
<circle cx="660" cy="175" r="6" fill="#6366f1"/>
<text x="560" y="200" text-anchor="middle" fill="#6366f1" font-size="10">음성은 멀리 밀려남</text>
</svg>

이 학습은 보통 두 단계로 이루어진다. 먼저 방대한 텍스트 쌍으로 대조 사전학습을 해서 넓은 의미 감각을 익히고, 그다음 좀 더 정제된 데이터로 대조 미세조정을 해서 검색 같은 특정 작업에 맞춘다[2]. 우리가 쓴 BGE-M3도 이런 대조학습으로 훈련된 다국어 임베딩 모델이라, 한국어와 영어가 섞인 공고에서도 의미가 통하는 것끼리 가깝게 놓는다. `02` 문서의 EV충전과 전기차충전이 0.84로 가까웠던 것이 바로 이 학습의 결과다.

## 2. 하이브리드 검색: 키워드와 의미의 결합

벡터 검색은 의미가 비슷한 것을 잘 찾지만 약점이 있다. 정확히 일치해야 하는 희귀 단어, 예를 들어 제품 코드나 고유한 기술명 같은 것은 의미가 아니라 글자 그대로 맞아야 하는데, 벡터는 이런 정확한 일치를 놓치기 쉽다[3]. 반대로 오래된 키워드 검색 방식인 BM25는 단어가 정확히 겹치는 문서를 잘 찾지만 의미는 전혀 이해하지 못한다. 뜻이 같아도 표현이 다르면 못 찾는다[3].

두 방식의 약점이 서로 반대라서, 둘을 합치면 서로의 사각지대를 메운다. 이것이 하이브리드 검색이다. 키워드 기반의 희소 검색인 BM25와 의미 기반의 밀집 벡터 검색을 각각 돌린 뒤, 두 결과를 하나의 순위로 합친다[4].

합칠 때 문제가 하나 있다. 두 점수의 척도가 다르다는 것이다. BM25 점수는 상한이 없는 양수인데 코사인 유사도는 -1에서 1 사이라, 그냥 더하거나 평균 내면 한쪽이 다른 쪽을 압도해버린다[3]. 그래서 점수 대신 순위만 쓰는 방법을 쓴다. 상호 순위 융합이라 불리는 RRF다. 각 문서에 대해 두 목록에서의 순위의 역수를 더해 최종 점수를 매기는 방식이라, 척도가 다른 문제를 애초에 피한다[3][4].

```
def rrf(list_bm25, list_vector, k=60):
    score = {}
    for rank, doc in enumerate(list_bm25):
        score[doc] = score.get(doc, 0) + 1 / (k + rank)
    for rank, doc in enumerate(list_vector):
        score[doc] = score.get(doc, 0) + 1 / (k + rank)
    return sorted(score, key=score.get, reverse=True)
```

<svg viewBox="0 0 720 230" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="20" fill="#334155" font-size="13">하이브리드 검색: 두 목록을 순위로 융합</text>
<rect x="20" y="40" width="180" height="150" rx="8" fill="#eef2ff" stroke="#6366f1"/>
<text x="110" y="62" text-anchor="middle" fill="#3730a3">BM25 (키워드)</text>
<text x="110" y="82" text-anchor="middle" fill="#6366f1" font-size="10">정확한 단어 일치에 강함</text>
<text x="110" y="108" text-anchor="middle" fill="#475569" font-size="10">1. 문서 A</text>
<text x="110" y="126" text-anchor="middle" fill="#475569" font-size="10">2. 문서 C</text>
<text x="110" y="144" text-anchor="middle" fill="#475569" font-size="10">3. 문서 B</text>
<rect x="20" y="200" width="180" height="0" fill="none"/>
<rect x="260" y="40" width="180" height="150" rx="8" fill="#ecfeff" stroke="#0891b2"/>
<text x="350" y="62" text-anchor="middle" fill="#155e75">벡터 (의미)</text>
<text x="350" y="82" text-anchor="middle" fill="#0891b2" font-size="10">뜻이 통하면 표현 달라도 찾음</text>
<text x="350" y="108" text-anchor="middle" fill="#475569" font-size="10">1. 문서 B</text>
<text x="350" y="126" text-anchor="middle" fill="#475569" font-size="10">2. 문서 D</text>
<text x="350" y="144" text-anchor="middle" fill="#475569" font-size="10">3. 문서 A</text>
<text x="470" y="115" fill="#94a3b8" font-size="18">→</text>
<rect x="500" y="40" width="200" height="150" rx="8" fill="#f0fdf4" stroke="#16a34a"/>
<text x="600" y="62" text-anchor="middle" fill="#166534">RRF 융합 결과</text>
<text x="600" y="82" text-anchor="middle" fill="#16a34a" font-size="10">순위의 역수를 합산</text>
<text x="600" y="108" text-anchor="middle" fill="#475569" font-size="10">1. 문서 A (양쪽 상위)</text>
<text x="600" y="126" text-anchor="middle" fill="#475569" font-size="10">2. 문서 B</text>
<text x="600" y="144" text-anchor="middle" fill="#475569" font-size="10">3. 문서 C, D</text>
<text x="360" y="216" text-anchor="middle" fill="#64748b" font-size="11">두 검색 모두에서 높은 문서가 최종 상위로 올라온다</text>
</svg>

우리 프로젝트는 현재 밀집 벡터만 쓰지만, BGE-M3는 원래 밀집과 희소를 함께 낼 수 있는 모델이라 하이브리드로 확장할 여지가 있다. 지금은 규칙 기반 SQL이 정확한 키워드 집계를 맡고 벡터가 의미 검색을 맡는 식으로 역할을 나눠, 하이브리드의 이점 일부를 다른 방식으로 얻고 있다.

## 3. 리랭킹: 정밀 재정렬

벡터 검색으로 뽑은 상위 문서가 항상 완벽한 순위는 아니다. 벡터 검색은 질문과 문서를 각각 따로 벡터로 만든 뒤 비교하는데, 이런 모델을 바이 인코더라 부른다. 문서 벡터를 미리 만들어두므로 수백만 건도 수 밀리초에 훑는 속도가 강점이지만, 질문과 문서를 따로 압축하다 보니 둘 사이의 미세한 관련성을 놓칠 수 있다[5][6].

이 순위를 다시 매기는 것이 리랭킹이고, 여기에 크로스 인코더를 쓴다. 크로스 인코더는 질문과 문서를 하나로 이어붙여 함께 모델에 넣어서, 질문의 모든 토큰이 문서의 모든 토큰을 살펴본 뒤 관련도 점수를 낸다[5][6]. 훨씬 정확하지만 쌍 하나마다 모델을 한 번씩 돌려야 해서 느리다[7].

그래서 실무는 두 단계로 나눈다. 먼저 빠른 바이 인코더로 전체에서 상위 후보 100개를 몇 밀리초에 추리고, 그다음 느리지만 정확한 크로스 인코더로 그 100개만 다시 채점해 순위를 바로잡는다[7]. 전수에 크로스 인코더를 쓰면 불가능하지만, 100개로 좁힌 뒤 쓰면 감당할 만하다.

<svg viewBox="0 0 720 210" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="sans-serif" font-size="12">
<text x="8" y="20" fill="#334155" font-size="13">2단계 검색: 넓게 추린 뒤 정밀하게 재정렬</text>
<rect x="20" y="45" width="200" height="120" rx="8" fill="#eef2ff" stroke="#6366f1"/>
<text x="120" y="68" text-anchor="middle" fill="#3730a3">1단계 바이 인코더</text>
<text x="120" y="88" text-anchor="middle" fill="#6366f1" font-size="10">전체 56만 건에서</text>
<text x="120" y="104" text-anchor="middle" fill="#6366f1" font-size="10">상위 100개 추출</text>
<text x="120" y="128" text-anchor="middle" fill="#16a34a" font-size="10">빠름 (수 밀리초)</text>
<text x="120" y="146" text-anchor="middle" fill="#64748b" font-size="10">넓지만 순위는 거침</text>
<text x="240" y="110" fill="#94a3b8" font-size="18">→</text>
<rect x="270" y="45" width="200" height="120" rx="8" fill="#fef2f2" stroke="#dc2626"/>
<text x="370" y="68" text-anchor="middle" fill="#991b1b">2단계 크로스 인코더</text>
<text x="370" y="88" text-anchor="middle" fill="#dc2626" font-size="10">그 100개만</text>
<text x="370" y="104" text-anchor="middle" fill="#dc2626" font-size="10">질문과 함께 재채점</text>
<text x="370" y="128" text-anchor="middle" fill="#ca8a04" font-size="10">느림 (수십 밀리초)</text>
<text x="370" y="146" text-anchor="middle" fill="#64748b" font-size="10">좁지만 순위가 정밀</text>
<text x="490" y="110" fill="#94a3b8" font-size="18">→</text>
<rect x="520" y="45" width="180" height="120" rx="8" fill="#f0fdf4" stroke="#16a34a"/>
<text x="610" y="68" text-anchor="middle" fill="#166534">최종 top-k</text>
<text x="610" y="92" text-anchor="middle" fill="#16a34a" font-size="10">정확도와 속도를</text>
<text x="610" y="108" text-anchor="middle" fill="#16a34a" font-size="10">둘 다 확보</text>
</svg>

리랭킹에 자주 쓰는 오픈 모델이 BGE 계열의 리랭커다. bge-reranker-v2-m3는 다국어를 지원하고 크기가 작아서 후보 100개 정도는 CPU에서도 돌릴 수 있다[8]. 우리 설계도 임베딩은 BGE-M3, 리랭킹은 같은 계열의 리랭커를 쓰는 조합을 염두에 두었다.

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")
# 1단계에서 벡터로 추린 후보들
candidates = ["백엔드 개발자 공고 ...", "프론트엔드 공고 ...", "..."]
pairs = [(query, doc) for doc in candidates]
scores = reranker.predict(pairs)   # 질문-문서 쌍마다 관련도 점수
ranked = [doc for _, doc in sorted(zip(scores, candidates), reverse=True)]
```

## 4. HNSW 인덱스 파라미터 튜닝

`02` 문서에서 전수 비교는 느려서 근사 최근접 이웃을 쓰고, 그 대표가 HNSW라고 했다. HNSW는 계층 그래프를 미리 만들어 두고 그 위를 건너뛰며 탐색하는데, 그래프를 얼마나 촘촘하게 만들지와 탐색을 얼마나 넓게 할지를 파라미터로 조절한다. pgvector 기준으로 세 개가 핵심이다[9][10].

| 파라미터 | 언제 쓰나 | 뜻 | 기본값 | 올리면 |
|---|---|---|---|---|
| m | 인덱스 생성 시 | 노드당 연결 수 | 16 | 정확도 상승, 메모리와 빌드 시간 증가 |
| ef_construction | 인덱스 생성 시 | 빌드 때 후보 목록 크기 | 64 | 그래프 품질 상승, 빌드 시간 증가 |
| ef_search | 검색 시 | 질의 때 후보 목록 크기 | 40 | 재현율 상승, 검색 속도 저하 |

m은 그래프에서 각 노드가 몇 개의 이웃과 연결되는지를 정한다. 크게 잡으면 고차원 데이터에서 재현율이 오르지만, 연결이 많아지는 만큼 메모리를 더 쓴다. 노드 N개에 대해 연결 목록만으로도 대략 4 곱하기 m 곱하기 N 곱하기 1.1 바이트가 들어서, m을 키우면 대규모 데이터에서 메모리가 병목이 된다[9]. 그래서 보통 12에서 48 사이에서 시작하고, 대규모에서는 16에서 24 정도를 권장한다[9][10].

ef_construction은 인덱스를 만들 때 이웃 후보를 얼마나 넓게 살펴볼지를 정한다. 높이면 더 좋은 그래프가 나오지만 빌드가 느려지고, 어느 선을 넘으면 품질은 거의 안 오르고 시간만 늘어나므로 96에서 128 정도가 실용적이다[9][10].

ef_search는 실제 검색 시점의 조절 손잡이다. 이 값을 키우면 더 많은 후보를 살펴 정확한 결과를 얻지만 그만큼 느려지고, 줄이면 빨라지지만 관련 문서를 놓칠 수 있다. m과 ef_construction은 인덱스를 다시 만들어야 바뀌지만 ef_search는 질의마다 즉석에서 바꿀 수 있어서, 정확도와 속도의 균형을 잡는 1차 손잡이로 쓴다[10].

```sql
-- HNSW 인덱스 생성. 코사인 거리 기준.
CREATE INDEX ON posting_embedding
  USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 128);

-- 이 세션의 검색 정확도-속도 균형을 조절.
SET hnsw.ef_search = 100;
```

우리 프로젝트는 아직 벡터 검색을 기능 플래그로만 열어 둔 상태라 HNSW 인덱스를 프로덕션에 올리지 않았고, 따라서 우리 데이터에서의 빌드 시간과 질의 지연 실측은 아직 없다. 이 수치는 벡터 검색을 실제로 켜는 시점에 측정해 `00-environment.md`의 해당 항목과 함께 채운다. 다만 위의 권장 범위는 출처가 뒷받침하는 일반 지침이므로, 그때 이 값들을 출발점으로 삼는다.

## 5. 정리

네 기법은 각각 검색의 다른 단계를 개선한다. 임베딩 학습은 벡터의 품질 자체를 결정하는 뿌리이고, 하이브리드 검색은 키워드와 의미의 사각지대를 서로 메우며, 리랭킹은 추려낸 결과의 순위를 정밀하게 바로잡고, HNSW 튜닝은 검색의 속도와 정확도 사이에서 균형점을 찾는다. 공통된 교훈은 검색이 한 번의 코사인 계산으로 끝나는 것이 아니라 여러 단계로 쌓아 올리는 파이프라인이라는 점이며, 각 단계마다 정확도와 비용의 트레이드오프가 있다는 것이다.

## 참고 자료

1. [Contrastive learning with hard negatives for sentence embeddings](https://www.sciencedirect.com/science/article/abs/pii/S1568494625009962)
2. [Text and Code Embeddings by Contrastive Pre-Training (OpenAI)](https://arxiv.org/pdf/2201.10005)
3. [Hybrid Search for RAG: Combining BM25 and Dense Vector Search](https://denser.ai/blog/hybrid-search-for-rag/)
4. [Hybrid Search Explained (Weaviate)](https://weaviate.io/blog/hybrid-search-explained)
5. [Bi-Encoders vs Cross-Encoders (ZeroEntropy)](https://zeroentropy.dev/articles/biencoder-vs-crossencoder/)
6. [Reranker (BGE documentation)](https://bge-model.com/Introduction/reranker.html)
7. [Rerankers and Two-Stage Retrieval (Pinecone)](https://www.pinecone.io/learn/series/rag/rerankers/)
8. [Reranking and Cross-Encoders for RAG: BGE, Cohere, Jina](https://localaimaster.com/blog/reranking-cross-encoders-guide)
9. [HNSW Indexes with Postgres and pgvector (Crunchy Data)](https://www.crunchydata.com/blog/hnsw-indexes-with-postgres-and-pgvector)
10. [How to optimize performance when using pgvector (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/cosmos-db/postgresql/howto-optimize-performance-pgvector)
