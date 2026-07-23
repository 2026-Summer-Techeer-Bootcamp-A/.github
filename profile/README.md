<!-- TODO: 프로젝트명 확정되면 제목/뱃지/설명 교체 -->
<h1 align="center">Sherpa</h1>

<p align="center">
  채용 공고 및 트렌드 데이터를 활용한 이력서 인사이트 서비스
</p>

# Table of Contents
- [Introduction](#introduction)
- [Demo](#demo)
- [API](#-api)
- [System Architecture](#-system-architecture)
- [ERD](#-erd)
- [Tech Stack](#-tech-stack)
- [Monitoring](#-monitoring)
- [How to Start](#-how-to-start)
- [Member](#-member)
<br>

# Introduction
### URL
<blockquote>
Frontend: https://frontend-tan-chi-25.vercel.app
</blockquote>

<br>

# Demo

### 홈 화면
<img src="./service-screenshots/home.png" width="850" alt="홈 화면" />
<br><br>

### 대시보드
<img src="./service-screenshots/dashboard.png" width="850" alt="대시보드" />
<br><br>

### 커리어 로드맵
<img src="./service-screenshots/roadmap.png" width="850" alt="커리어 로드맵" />
<br><br>

### 채용 시장
<img src="./service-screenshots/hiring_market.png" width="850" alt="채용 시장" />
<br><br>

### AI 어시스턴트
<img src="./service-screenshots/assistant.png" width="850" alt="AI 어시스턴트" />
<br><br>


# 🔌 API
FastAPI 자동 생성 문서(`/docs`, Swagger UI) 기준, 테스트/디버그 전용 엔드포인트(`/test-ui`, `/easy-dash`, `/db-viewer`, `/api/db/tables*`)를 제외한 전체 엔드포인트예요.

### 시스템 (헬스체크 · 메트릭)
<img src="./api-screenshots/00-default.png" width="850" alt="system API" />
<br><br>

### 인증 (auth)
<img src="./api-screenshots/01-auth.png" width="850" alt="auth API" />
<br><br>

### 자격증 (cert)
<img src="./api-screenshots/02-cert.png" width="850" alt="cert API" />
<br><br>

### 직군 카테고리 (job-categories)
<img src="./api-screenshots/03-job-categories.png" width="850" alt="job-categories API" />
<br><br>

### 이력서 (resume)
<img src="./api-screenshots/04-resume.png" width="850" alt="resume API" />
<br><br>

### 기술 (skills)
<img src="./api-screenshots/05-skills.png" width="850" alt="skills API" />
<br><br>

### 매칭 분석 (match)
<img src="./api-screenshots/06-match.png" width="850" alt="match API" />
<br><br>

### 공고 지도 (posting-map)
<img src="./api-screenshots/07-posting-map.png" width="850" alt="posting-map API" />
<br><br>

### 채용 공고 (postings)
<img src="./api-screenshots/08-postings.png" width="850" alt="postings API" />
<br><br>

### 회사 (company)
<img src="./api-screenshots/09-company.png" width="850" alt="company API" />
<br><br>

### 시장 인사이트 (insight)
<img src="./api-screenshots/10-insight.png" width="850" alt="insight API" />
<br><br>

### GitHub 트렌드 (github-insight)
<img src="./api-screenshots/11-github-insight.png" width="850" alt="github-insight API" />
<br><br>

### 관리자 (admin)
<img src="./api-screenshots/12-admin.png" width="850" alt="admin API" />
<br><br>

### 검색 (search)
<img src="./api-screenshots/13-search.png" width="850" alt="search API" />
<br><br>

### AI 챗봇 (chat)
<img src="./api-screenshots/14-chat.png" width="850" alt="chat API" />
<br><br>

### 뉴스 (news)
<img src="./api-screenshots/15-news.png" width="850" alt="news API" />
<br><br>

### 피드 (feed)
<img src="./api-screenshots/16-feed.png" width="850" alt="feed API" />
<br><br>

# 🏗 System Architecture
<img width="100%" alt="architecture-detail" src="./sa-architecture-detail.png" />
<img width="100%" alt="architecture-stack" src="./sa-architecture-stack.png" />
<br><br>

# 🗃 ERD
<img width="100%" alt="ERD" src="./f.png" />
<br><br>

# 🧰 Tech Stack
<table style="width:100%; background:#ffffff; border-collapse:collapse;">
  <tr style="background:#ffffff;">
    <th align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">Field</th>
    <th align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">Technology of Use</th>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>Frontend</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black">
      <img src="https://img.shields.io/badge/React%20Router-CA4245?style=for-the-badge&logo=reactrouter&logoColor=white">
      <img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white">
      <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white">
      <br/>
      <img src="https://img.shields.io/badge/D3.js-F9A03C?style=for-the-badge&logo=d3dotjs&logoColor=white">
      <img src="https://img.shields.io/badge/ECharts-AA344D?style=for-the-badge&logo=apacheecharts&logoColor=white">
      <img src="https://img.shields.io/badge/Leaflet-199900?style=for-the-badge&logo=leaflet&logoColor=white">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>Backend</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white">
      <img src="https://img.shields.io/badge/Uvicorn-111827?style=for-the-badge">
      <img src="https://img.shields.io/badge/SQLAlchemy-CC0000?style=for-the-badge">
      <br/>
      <img src="https://img.shields.io/badge/Pydantic-E92063?style=for-the-badge&logo=pydantic&logoColor=white">
      <img src="https://img.shields.io/badge/PyJWT-111827?style=for-the-badge">
      <img src="https://img.shields.io/badge/bcrypt-334155?style=for-the-badge">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>Database</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white">
      <img src="https://img.shields.io/badge/pgvector-336791?style=for-the-badge">
      <img src="https://img.shields.io/badge/Redis-DC382D?style=for-the-badge&logo=redis&logoColor=white">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>AI</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/Gemini-1A73E8?style=for-the-badge&logo=google&logoColor=white">
      <img src="https://img.shields.io/badge/Sentence--Transformers%20(BGE--M3)-FFD21E?style=for-the-badge">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>DevOps</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white">
      <img src="https://img.shields.io/badge/Traefik-24A1C1?style=for-the-badge&logo=traefikproxy&logoColor=white">
      <img src="https://img.shields.io/badge/Google%20Cloud-4285F4?style=for-the-badge&logo=googlecloud&logoColor=white">
      <img src="https://img.shields.io/badge/GitHub%20Actions-2088FF?style=for-the-badge&logo=githubactions&logoColor=white">
      <img src="https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>Monitoring</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/Prometheus-E6522C?style=for-the-badge&logo=prometheus&logoColor=white">
      <img src="https://img.shields.io/badge/Grafana-F46800?style=for-the-badge&logo=grafana&logoColor=white">
      <img src="https://img.shields.io/badge/Grafana%20Loki-F46800?style=for-the-badge&logo=grafana&logoColor=white">
      <img src="https://img.shields.io/badge/Grafana%20Tempo-F46800?style=for-the-badge&logo=grafana&logoColor=white">
      <img src="https://img.shields.io/badge/Grafana%20Alloy-F46800?style=for-the-badge&logo=grafana&logoColor=white">
    </td>
  </tr>

  <tr style="background:#ffffff;">
    <td align="center" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;"><b>ETC</b></td>
    <td align="left" style="background:#ffffff; border:1px solid #e5e7eb; padding:10px;">
      <img src="https://img.shields.io/badge/Slack-4A154B?style=for-the-badge&logo=slack&logoColor=white">
      <img src="https://img.shields.io/badge/Discord-5865F2?style=for-the-badge&logo=discord&logoColor=white">
      <img src="https://img.shields.io/badge/Notion-000000?style=for-the-badge&logo=notion&logoColor=white">
      <img src="https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white">
    </td>
  </tr>
</table>
<br/>

# 📊 Monitoring
> TODO: Grafana 대시보드(FastAPI / Redis / PostgreSQL 패널) 스크린샷을 채워주세요. 로컬에서는 `docker compose up -d` 후 http://localhost:3000 에서 확인할 수 있어요.
<br>

# 🚀 How to Start
#### 1. Clone The Repository
```bash
git clone https://github.com/2026-Summer-Techeer-Bootcamp-A/backend.git
git clone https://github.com/2026-Summer-Techeer-Bootcamp-A/frontend.git
```
#### 2. ENV Setting
- `backend/.env` (`.env.example` 참고)
```bash
# Local dev convenience
COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml

# App
APP_IMAGE=career-backend:local
APP_PORT=8000
LOG_LEVEL=info
DOMAIN_NAME=your-domain.com
ACME_EMAIL=your-email@example.com

# CORS
CORS_ORIGINS=["http://localhost:3000","https://your-frontend-domain.com"]

# Database
POSTGRES_HOST=db
POSTGRES_DB=appdb_load
POSTGRES_USER=appuser
POSTGRES_PASSWORD=change-me
POSTGRES_PORT=5432
DATABASE_URL=postgresql+psycopg://appuser:change-me@db:5432/appdb_load

# Redis
REDIS_PORT=6379
REDIS_URL=redis://redis:6379/0

# Observability exporters
POSTGRES_EXPORTER_DSN=postgresql://appuser:change-me@db:5432/appdb_load?sslmode=disable
REDIS_EXPORTER_ADDR=redis://redis:6379

# Observability
GF_SECURITY_ADMIN_PASSWORD=change-me

# 외부 API
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-3.5-flash-lite
```
#### 3. Run Docker (Backend + DB + Redis + Monitoring)
```bash
cd backend

# 전체 서비스 실행 (.env의 COMPOSE_FILE 설정으로 dev 오버라이드까지 함께 뜸)
docker compose up -d --build

# 종료
docker compose down
```
브라우저로 확인:
- http://localhost:8000/docs : API 문서 (Swagger UI)
- http://localhost:3000 : Grafana (admin / `.env`의 `GF_SECURITY_ADMIN_PASSWORD`)
- http://localhost:9090 : Prometheus

#### 4. Frontend
```bash
cd frontend
npm install
npm run dev
```
→ http://localhost:5173
<br>

## 👥 Member

| Name | 김강문 | 박성훈 | 방준혁 | 최혜민 | 이동건 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| Profile | <img width="100px" height="100px" src="https://avatars.githubusercontent.com/u/234728447?v=4" /> | <img width="100px" height="100px" src="https://avatars.githubusercontent.com/u/237693337?v=4" /> | <img width="100px" height="100px" src="https://avatars.githubusercontent.com/u/218049391?v=4" /> | <img width="100px" height="100px" src="https://avatars.githubusercontent.com/u/297794212?v=4" /> | <img width="100px" height="100px" src="https://avatars.githubusercontent.com/u/265196611?v=4" /> |
| Role | Team Leader<br>Frontend<br>Backend<br>DevOps | Frontend<br>Backend | Frontend<br>Backend<br>DevOps | Frontend<br>Backend | Frontend<br>Backend |
| GitHub | <a href="https://github.com/rivermoon-03"><img src="http://img.shields.io/badge/rivermoon--03-green?style=social&logo=github"/></a> | <a href="https://github.com/sunghoon0303"><img src="http://img.shields.io/badge/sunghoon0303-green?style=social&logo=github"/></a> | <a href="https://github.com/whatmakesaman"><img src="http://img.shields.io/badge/whatmakesaman-green?style=social&logo=github"/></a> | <a href="https://github.com/chm9614"><img src="http://img.shields.io/badge/chm9614-green?style=social&logo=github"/></a> | <a href="https://github.com/1102leedg"><img src="http://img.shields.io/badge/1102leedg-green?style=social&logo=github"/></a> |
