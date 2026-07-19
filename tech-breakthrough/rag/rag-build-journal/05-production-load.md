# 프로덕션 적재: 마트에서 Cloud SQL까지

## 목표

앞 단계까지 마트(SQLite)에 공고 565,191건과 임베딩 565,191건을 만들어 두었고, 이제 이 데이터를 프로덕션 Postgres(Cloud SQL)에 올려야 배포된 백엔드가 RAG로 데이터를 조회할 수 있다.

다만 이 작업은 단순 복사가 아니다. 마트 스키마와 프로덕션 스키마가 서로 달라서, 그 차이를 메우는 ETL을 따로 짜야 한다.

## 스키마 임피던스

마트와 프로덕션은 설계 철학이 다르며, 그 차이는 아래 표로 정리된다.

| 항목 | 마트(SQLite) | 프로덕션(Postgres) |
|---|---|---|
| 공고 ID | 문자열 `source:id` | 정수 시퀀스 `posting.id` |
| 기술 | 이름 문자열 `Python` | `posting_tech.skill_id` 정수 FK |
| 자격증 | 이름 문자열 | `posting_cert.cert_id` 정수 FK |
| 개념 | 이름 문자열 | 테이블 자체가 없음 |
| 임베딩 | float32 BLOB | pgvector `vector(1024)` |

이 표에서 드러나는 문제는 세 가지로 정리된다. 첫째는 문자열 ID를 정수 시퀀스로 바꾸고 그 매핑을 tech, cert, embedding까지 이어야 한다는 것이고, 둘째는 기술과 자격증 이름을 마스터 테이블의 정수 id로 해소해야 한다는 것이며, 셋째는 개념축을 담을 테이블 자체가 프로덕션에 없다는 것이다.

## 개념축 모델 신설

개념축은 이 프로젝트의 시그니처 기능인데도 백엔드 스키마에는 그것을 담을 자리가 없었다. 그래서 `Concept`와 `PostingConcept` 모델을 새로 신설했고, 기존 `Skill`과 `PostingTech` 패턴을 그대로 미러링해서 설계했다.

`Concept`은 이름과 상위 분류만 가지며, 별칭 테이블은 따로 두지 않았다. 별칭은 마트를 만드는 단계에서 이미 정규명으로 해소해 두었기 때문이다.

## source_uid 폭 문제

첫 적재 시도는 곧바로 깨졌다.

```
StringDataRightTruncation: value too long for type character varying(64)
```

원인은 `posting.source_uid` 컬럼이 `String(64)`로 잡혀 있었다는 데 있었다. 그런데 일부 해외 소스와 일부 국내 소스는 URL 자체를 uid로 저장하는 방식을 쓰고 있어서, 한 해외 소스는 사실상 전부 64자를 넘겼고 한 국내 소스는 트래킹 파라미터까지 붙어 691자까지 늘어났다.

숫자 ID를 쓰는 소스만 있던 소량 테스트에서는 이 문제가 드러나지 않았는데, uid가 짧았기 때문이다. 전체 소스를 넣고서야 URL uid에서 터졌다.

해결은 `source_uid`를 `Text`로 넓히는 것이었다. 이렇게 하면 마트 ID를 그대로 보존할 수 있고, 고유성이 깨질 위험도 없다.

## 적재 스크립트 완성

백엔드에는 `scripts/load_mart.py`가 이미 존재했지만 뼈대만 있는 미완성 상태였다. `seed_dicts`와 `load_postings`는 구현되어 있었으나 링크 로더가 빠져 있었고, 그 없던 부분을 채워 넣었다.

- `build_concept_rows`, `seed_concepts`: 개념 마스터 시딩
- 링크 로더 5종: tech, cert, concept, category, embedding
- `load_embeddings`: float32 BLOB을 pgvector로 스트리밍 삽입한다. 전량을 메모리에 올리지 않고 1000건씩 끊어 flush하는데, 565k를 리스트로 통째로 들면 수 기가바이트라 터지기 때문이다.
- `main`: argparse로 마트/임베딩 경로와 옵션을 받는다.

새 스크래치 스크립트를 짜지 않고 레포에 있던 미완성 스크립트를 완성하는 쪽을 택했는데, 그래야 코드가 레포에 남고 테스트로 지켜지기 때문이다.

## 비파괴 로컬 적재

dev DB에는 데모용 유저 20명과 이력서 29건이 이미 들어 있었는데, `load_mart`의 `wipe`는 모든 테이블을 비우는 동작이라 그대로 돌리면 dev 데이터를 날려버릴 수밖에 없었다.

그래서 일회용 DB `appdb_load`를 새로 만들어 pgvector와 citext 확장을 켠 다음 거기에 풀 로드를 실행했고, dev DB는 전혀 건드리지 않았다.

결과는 전부 정합했다.

```
posting 565,191   embedding 565,191 (1:1, 고아 0 누락 0)
tech 536,635   cert 13,974   category 55,546   concept 196,734
skill 490   alias 508   cert 48   concept 27
```

적재에는 5분 30초가 걸렸고, 벡터는 dim 1024에 자기 코사인 거리가 0으로 나와 정상임을 확인했다.

## Cloud SQL 푸시

Cloud SQL 인스턴스는 프라이빗 IP만 가지고 있어서 내 로컬에서 직접 붙을 수 없었고, 그래서 GCS 서버사이드 import 방식을 썼다. 덤프를 GCS에 올려두면 `gcloud sql import`가 인스턴스 안에서 그 덤프를 읽어들이는 구조다.

방식은 스키마까지 포함한 덤프로 잡았다. 프로덕션 스키마에는 개념 테이블이 아직 없고 source_uid도 여전히 varchar(64)라서, 데이터만 밀어넣으면 그대로 깨지기 때문에 스키마째 갈아야 했다.

타깃은 11개 테이블만 잡았는데, posting 계열 6개와 사전 테이블 5개다. user, resume, github 테이블은 덤프에서 뺐고, 그 데이터는 보존해야 했기 때문이다.

### 함정 1: 외부 FK가 막는 DROP

첫 시도는 `pg_dump --clean`으로 했다.

```
cannot drop constraint skill_pkey on table public.skill
because other objects depend on it
DETAIL: interest_signal_skill_id_fkey, resume_skill_skill_id_fkey depend on it
```

`--clean`은 `DROP TABLE`을 실행하기 전에 `ALTER TABLE DROP CONSTRAINT skill_pkey`를 개별적으로 먼저 실행하는데, 여기에는 CASCADE가 붙지 않는다. 그런데 interest_signal과 resume_skill이 skill을 FK로 참조하고 있어서 이 지점에서 막혔다.

다만 이 에러는 역설적으로 유용했는데, Cloud SQL에 그 테이블들이 실재한다는 사실을 확인해준 셈이었다.

### 해결: 명시적 DROP CASCADE

`--clean`을 버리고, 대신 덤프 앞에 명시적으로 `DROP TABLE ... CASCADE`를 직접 붙이는 쪽으로 바꿨다. 순서는 자식에서 부모로 11개 테이블을 나열했다.

이렇게 하면 CASCADE가 skill과 cert로 향하는 외부 FK를 정리해서 그 링크 제약은 사라지지만 데이터 행 자체는 남는다. 다만 skill id가 새로 매겨지기 때문에 이력서 링크는 나중에 따로 재구축해야 하는데, 아직 데모 단계라 이 정도는 감수하기로 했다.

### 함정 2: vector 확장

타깃 테이블만 덤프하면 확장은 함께 딸려오지 않는데, `posting_embedding`의 vector 타입은 그 확장을 필요로 한다. 그래서 덤프 맨 앞에 `CREATE EXTENSION IF NOT EXISTS vector`를 붙였다. 배포된 백엔드가 이미 켜 두었을 것이므로 대체로 no-op이 되겠지만, 안전장치로 남겨두었다.

### 함정 3: 서비스 계정 권한

첫 import는 HTTP 412로 실패했다.

```
The service account does not have the required permissions for the bucket.
```

`gcloud sql import`는 Cloud SQL 인스턴스에 붙은 서비스 계정으로 GCS를 읽는데, 그 계정에 버킷 objectViewer 권한이 없었던 것이 원인이었다. 계정에 권한을 부여한 뒤 재시도했다.

### 성공

두 번째 덤프로는 import가 성공했고, 2.28 GB gzip을 약 3분에 replay했다.

## 검증

Cloud SQL은 프라이빗 IP라 로컬에서 직접 카운트를 셀 수 없었지만, 배포된 백엔드에 db-viewer 엔드포인트가 있어서 공개 도메인을 통해 실카운트를 확인할 수 있었다.

```
posting 565,191   posting_embedding 565,191
posting_tech 536,635   posting_cert 13,974
posting_category 55,546   posting_concept 196,734
skill 490   cert 48   concept 27
resume_skill 5,235   resume_cert 947 (보존됨)
```

이 결과는 마트와 정확히 일치했고 이력서 데이터도 그대로 남아 있었다. 비파괴 적재가 확인된 셈이다.

## 배운 것

프로덕션 적재는 결국 복사가 아니라 번역에 가깝다는 것이 이번 작업의 핵심이다. 스키마가 다르면 ID와 이름을 전부 매핑해야 하기 때문이다.

프라이빗 IP DB는 직접 붙을 수 없으므로, GCS를 경유한 import가 현실적인 우회로가 된다.

`pg_dump --clean`은 외부 FK가 걸려 있으면 막히기 쉬우므로, 명시적으로 DROP CASCADE를 써주는 쪽이 확실하다.

되돌리기 어려운 프로덕션 작업은 반드시 비파괴로 설계해야 한다. 일회용 DB에서 먼저 검증하고, 타깃 테이블만 건드리는 방식이 안전하다.
