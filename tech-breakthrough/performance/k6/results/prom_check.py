import urllib.request, urllib.parse, json

BASE = "http://localhost:9090/api/v1/query"

def q(query):
    url = BASE + "?" + urllib.parse.urlencode({"query": query})
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            d = json.load(r)
        return d.get("data", {}).get("result", [])
    except Exception:
        return []

def scalar(query, unit="", fmt=".1f"):
    r = q(query)
    if r:
        v = r[0]["value"][1]
        if v not in ["NaN", "+Inf", "-Inf"]:
            return f"{float(v):{fmt}}{unit}"
    return "N/A"

print("=" * 52)
print("  PROMETHEUS SNAPSHOT  (k6 Stress 600VU 진행중)")
print("=" * 52)

rps = scalar('sum(rate(http_requests_total[1m]))', ' req/s')
tps = scalar('rate(pg_stat_database_xact_commit{datname="appdb"}[1m])', ' tx/s')
db_conn = scalar('pg_stat_database_numbackends{datname="appdb"}', '개', '.0f')
db_active = scalar('pg_stat_activity_count{datname="appdb",state="active"}', '개', '.0f')
hit_rate = scalar(
    'sum(pg_stat_database_blks_hit{datname="appdb"}) / '
    '(sum(pg_stat_database_blks_hit{datname="appdb"}) + '
    'sum(pg_stat_database_blks_read{datname="appdb"})) * 100', '%')
deadlocks = scalar('pg_stat_database_deadlocks{datname="appdb"}', '건', '.0f')
rollback = scalar(
    'rate(pg_stat_database_xact_rollback{datname="appdb"}[1m]) / '
    '(rate(pg_stat_database_xact_commit{datname="appdb"}[1m]) + '
    'rate(pg_stat_database_xact_rollback{datname="appdb"}[1m])) * 100', '%')

print(f"\n[FastAPI]")
print(f"  RPS        : {rps}")

print(f"\n[DB (appdb)]")
print(f"  TPS        : {tps}")
print(f"  연결 수    : {db_conn}")
print(f"  Active 쿼리: {db_active}")
print(f"  버퍼히트율 : {hit_rate}")
print(f"  데드락     : {deadlocks}")
print(f"  롤백율     : {rollback}")

print("\n[레이턴시 분위수 - rate(1m)]")
for p, label in [("0.5","p50"), ("0.9","p90"), ("0.95","p95"), ("0.99","p99")]:
    r = q(f'histogram_quantile({p}, sum by(le) (rate(http_request_duration_seconds_bucket[1m])))')
    if r:
        v = r[0]["value"][1]
        if v not in ["NaN", "+Inf", "-Inf"]:
            ms = float(v) * 1000
            flag = "✅" if ms < 1000 else ("⚠️" if ms < 3000 else "❌")
            print(f"  {label}: {ms:.0f}ms {flag}")
        else:
            print(f"  {label}: ∞ (서버 포화 — 타임아웃 폭발)")
    else:
        print(f"  {label}: N/A")

print("\n[HTTP 상태코드별 처리량 - rate(1m)]")
errs = q('rate(http_requests_total[1m])')
status_map = {}
for item in errs:
    s = item["metric"].get("status", "?")
    v = float(item["value"][1])
    status_map[s] = status_map.get(s, 0) + v
for s in sorted(status_map):
    icon = "✅" if s.startswith("2") else ("⚠️" if s.startswith("4") else "❌")
    print(f"  {icon} {s}: {status_map[s]:.2f} req/s")
