#!/usr/bin/env bash
set -euo pipefail
trap 'echo "ERROR: command failed at line $LINENO" >&2' ERR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SNAPSHOT_FILE="$SCRIPT_DIR/snapshot.json"
SYSCTL_DROPIN="/etc/sysctl.d/99-stability-toggle.conf"
THP_PATH="/sys/kernel/mm/transparent_hugepage/enabled"
COMPOSE_SERVICE="app"
COMPOSE_BACKUP=""

readonly -a ITEM_LIST=(
  zram
  swappiness
  min_free_kbytes
  thp
  dirty_ratio
  dirty_background_ratio
  vfs_cache_pressure
  tcp_max_syn_backlog
  net_mem
  container_limits
  container_ulimit
)

print_help() {
  cat <<EOF
Usage: sudo ./toggle.sh <snapshot|apply|revert> [options]

Commands:
  snapshot                 Capture current values of all 11 tuned items into snapshot.json
  apply                    Apply the After (optimized) values for the targeted items
  revert                   Restore the targeted items to the snapshot.json (Before) values

Options:
  --only <item>            Limit apply/revert to a single item (see item list below)
  --compose-file <path>    Path to docker-compose.yml (overrides COMPOSE_FILE env var)
  -h, --help                Show this help message

Environment:
  COMPOSE_FILE              Path to docker-compose.yml on the target VM.
                            Default placeholder: /opt/app/docker-compose.yml
                            This has not been confirmed against the real app-vm
                            path yet. Always pass --compose-file or set
                            COMPOSE_FILE explicitly before running on the
                            production host.

Items (valid values for --only):
  zram                     6GB zram swap device, lz4 compression
  swappiness               vm.swappiness (60 -> 60, unchanged: zram makes swap cheap)
  min_free_kbytes          vm.min_free_kbytes (65536 -> 131072)
  thp                      transparent hugepage mode (always -> never)
  dirty_ratio              vm.dirty_ratio (20 -> 10)
  dirty_background_ratio   vm.dirty_background_ratio (10 -> 5)
  vfs_cache_pressure       vm.vfs_cache_pressure (100 -> 50)
  tcp_max_syn_backlog      net.ipv4.tcp_max_syn_backlog (1024 -> 8192)
  net_mem                  net.core.rmem_max / wmem_max (212992 -> 4194304)
  container_limits         app service mem_limit 4g / cpus 4 in compose file
  container_ulimit         app service ulimits.nofile 65536 in compose file

Examples:
  sudo ./toggle.sh snapshot
  sudo ./toggle.sh apply
  sudo ./toggle.sh apply --only swappiness
  sudo ./toggle.sh revert
  sudo ./toggle.sh revert --only zram
  sudo COMPOSE_FILE=/opt/app/docker-compose.yml ./toggle.sh apply

Files:
  snapshot.json             Stored next to this script, holds Before values.
  $SYSCTL_DROPIN
                            Managed drop-in file for sysctl persistence across reboot.
EOF
}

require_root() {
  if [[ "$EUID" -ne 0 ]]; then
    echo "ERROR: this script must be run with sudo/root" >&2
    exit 1
  fi
}

require_deps() {
  local dep
  for dep in python3 sysctl modprobe zramctl swapon swapoff mkswap docker; do
    if ! command -v "$dep" >/dev/null 2>&1; then
      echo "ERROR: required command not found: $dep" >&2
      exit 1
    fi
  done
}

validate_item() {
  local item="$1"
  local valid
  for valid in "${ITEM_LIST[@]}"; do
    if [[ "$item" == "$valid" ]]; then
      return 0
    fi
  done
  echo "ERROR: unknown item '$item'. Valid items: ${ITEM_LIST[*]}" >&2
  exit 1
}

require_snapshot_exists() {
  if [[ ! -f "$SNAPSHOT_FILE" ]]; then
    echo "ERROR: snapshot file not found at $SNAPSHOT_FILE. Run 'sudo ./toggle.sh snapshot' before 'revert'." >&2
    exit 1
  fi
}

require_compose_file_exists() {
  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "ERROR: compose file not found at $COMPOSE_FILE (set COMPOSE_FILE env var or use --compose-file)" >&2
    exit 1
  fi
}

snapshot_value() {
  local key="$1"
  python3 - "$SNAPSHOT_FILE" "$key" <<'PYEOF'
import json
import sys

path, key = sys.argv[1], sys.argv[2]
with open(path) as f:
    data = json.load(f)
if key not in data:
    print(f"key '{key}' not found in {path}", file=sys.stderr)
    sys.exit(1)
value = data[key]
if isinstance(value, bool):
    print("true" if value else "false")
else:
    print(value)
PYEOF
}

dropin_set() {
  local key="$1"
  local value="$2"
  local tmp
  tmp="$(mktemp)"
  touch "$SYSCTL_DROPIN"
  grep -v -E "^${key}[[:space:]]*=" "$SYSCTL_DROPIN" > "$tmp" || true
  echo "${key} = ${value}" >> "$tmp"
  mv "$tmp" "$SYSCTL_DROPIN"
}

apply_sysctl() {
  local key="$1"
  local value="$2"
  sysctl -w "${key}=${value}" >/dev/null
  dropin_set "$key" "$value"
}

revert_sysctl() {
  local key="$1"
  local value
  value="$(snapshot_value "$key")"
  sysctl -w "${key}=${value}" >/dev/null
  dropin_set "$key" "$value"
}

get_thp_mode() {
  grep -oP '\[\K[a-z]+(?=\])' "$THP_PATH"
}

apply_thp() {
  echo never > "$THP_PATH"
}

revert_thp() {
  local mode
  mode="$(snapshot_value thp_enabled)"
  echo "$mode" > "$THP_PATH"
}

zram_is_active() {
  swapon --show=NAME --noheadings 2>/dev/null | grep -q '^/dev/zram'
}

apply_zram() {
  if zram_is_active; then
    echo "zram swap already active, skipping"
    return 0
  fi
  modprobe zram
  local dev
  dev="$(zramctl --find --size 6G --algorithm lz4)"
  mkswap "$dev" >/dev/null
  swapon "$dev"
  echo "zram activated on $dev"
}

revert_zram() {
  local before
  before="$(snapshot_value zram_active)"
  if [[ "$before" == "true" ]]; then
    echo "ERROR: snapshot recorded zram as already active before apply; automatic recreation of the prior zram state is not supported" >&2
    exit 1
  fi
  local devs
  devs="$(swapon --show=NAME --noheadings 2>/dev/null | grep '^/dev/zram' || true)"
  if [[ -z "$devs" ]]; then
    echo "zram already inactive, nothing to revert"
    return 0
  fi
  local dev
  while IFS= read -r dev; do
    swapoff "$dev"
    zramctl --reset "$dev"
  done <<< "$devs"
  echo "zram deactivated"
}

compose_block_present() {
  local marker="$1"
  grep -q "stability-toggle:${marker}:start" "$COMPOSE_FILE"
}

compose_block_insert() {
  local marker="$1"
  local block="$2"
  python3 - "$COMPOSE_FILE" "$COMPOSE_SERVICE" "$marker" "$block" <<'PYEOF'
import re
import sys

path, service, marker, block = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
start_tag = f"    # stability-toggle:{marker}:start"
end_tag = f"    # stability-toggle:{marker}:end"

with open(path) as f:
    lines = f.readlines()

service_re = re.compile(rf"^  {re.escape(service)}:\s*$")
other_re = re.compile(r"^  [A-Za-z0-9_.-]+:\s*$")

start_idx = None
end_idx = len(lines)
for i, line in enumerate(lines):
    if start_idx is None:
        if service_re.match(line):
            start_idx = i
        continue
    if other_re.match(line):
        end_idx = i
        break

if start_idx is None:
    print(f"service '{service}' not found in {path}", file=sys.stderr)
    sys.exit(1)

block_slice = lines[start_idx:end_idx]
if any(start_tag in l for l in block_slice):
    sys.exit(0)

insert_at = end_idx
for i in range(start_idx, end_idx):
    if lines[i].strip().startswith("restart:"):
        insert_at = i + 1
        break

new_block = [start_tag + "\n"]
new_block += [l + "\n" for l in block.split("\n") if l != ""]
new_block += [end_tag + "\n"]

lines[insert_at:insert_at] = new_block

with open(path, "w") as f:
    f.writelines(lines)
PYEOF
}

compose_block_remove() {
  local marker="$1"
  python3 - "$COMPOSE_FILE" "$marker" <<'PYEOF'
import sys

path, marker = sys.argv[1], sys.argv[2]
start_tag = f"stability-toggle:{marker}:start"
end_tag = f"stability-toggle:{marker}:end"

with open(path) as f:
    lines = f.readlines()

out = []
skipping = False
found = False
for line in lines:
    if start_tag in line:
        skipping = True
        found = True
        continue
    if end_tag in line:
        skipping = False
        continue
    if not skipping:
        out.append(line)

if not found:
    sys.exit(0)

with open(path, "w") as f:
    f.writelines(out)
PYEOF
}

apply_container_limits() {
  compose_block_insert container_limits $'    mem_limit: 4g\n    cpus: 4'
  COMPOSE_CHANGED=true
}

revert_container_limits() {
  compose_block_remove container_limits
  COMPOSE_CHANGED=true
}

apply_container_ulimit() {
  compose_block_insert container_ulimit $'    ulimits:\n      nofile:\n        soft: 65536\n        hard: 65536'
  COMPOSE_CHANGED=true
}

revert_container_ulimit() {
  compose_block_remove container_ulimit
  COMPOSE_CHANGED=true
}

backup_compose_file() {
  COMPOSE_BACKUP="$(mktemp "${COMPOSE_FILE}.stability-toggle.XXXXXX")"
  cp "$COMPOSE_FILE" "$COMPOSE_BACKUP"
}

restart_compose_stack() {
  echo "Validating $COMPOSE_FILE with docker compose config..."
  if ! docker compose -f "$COMPOSE_FILE" config >/dev/null; then
    echo "ERROR: docker compose config validation failed after edit, restoring backup" >&2
    if [[ -n "$COMPOSE_BACKUP" && -f "$COMPOSE_BACKUP" ]]; then
      cp "$COMPOSE_BACKUP" "$COMPOSE_FILE"
    fi
    exit 1
  fi
  docker compose -f "$COMPOSE_FILE" up -d
  echo "Waiting 30s for the container stack to stabilize..."
  sleep 30
  if [[ -n "$COMPOSE_BACKUP" && -f "$COMPOSE_BACKUP" ]]; then
    rm -f "$COMPOSE_BACKUP"
  fi
}

item_touches_compose() {
  case "$1" in
    container_limits|container_ulimit) return 0 ;;
    *) return 1 ;;
  esac
}

apply_item() {
  case "$1" in
    zram) apply_zram ;;
    swappiness) apply_sysctl vm.swappiness 60 ;;
    min_free_kbytes) apply_sysctl vm.min_free_kbytes 131072 ;;
    thp) apply_thp ;;
    dirty_ratio) apply_sysctl vm.dirty_ratio 10 ;;
    dirty_background_ratio) apply_sysctl vm.dirty_background_ratio 5 ;;
    vfs_cache_pressure) apply_sysctl vm.vfs_cache_pressure 50 ;;
    tcp_max_syn_backlog) apply_sysctl net.ipv4.tcp_max_syn_backlog 8192 ;;
    net_mem)
      apply_sysctl net.core.rmem_max 4194304
      apply_sysctl net.core.wmem_max 4194304
      ;;
    container_limits) apply_container_limits ;;
    container_ulimit) apply_container_ulimit ;;
    *)
      echo "ERROR: unknown item '$1'" >&2
      exit 1
      ;;
  esac
}

revert_item() {
  case "$1" in
    zram) revert_zram ;;
    swappiness) revert_sysctl vm.swappiness ;;
    min_free_kbytes) revert_sysctl vm.min_free_kbytes ;;
    thp) revert_thp ;;
    dirty_ratio) revert_sysctl vm.dirty_ratio ;;
    dirty_background_ratio) revert_sysctl vm.dirty_background_ratio ;;
    vfs_cache_pressure) revert_sysctl vm.vfs_cache_pressure ;;
    tcp_max_syn_backlog) revert_sysctl net.ipv4.tcp_max_syn_backlog ;;
    net_mem)
      revert_sysctl net.core.rmem_max
      revert_sysctl net.core.wmem_max
      ;;
    container_limits) revert_container_limits ;;
    container_ulimit) revert_container_ulimit ;;
    *)
      echo "ERROR: unknown item '$1'" >&2
      exit 1
      ;;
  esac
}

snapshot_cmd() {
  require_compose_file_exists

  local swappiness min_free dirty_ratio dirty_bg vfs_cache tcp_syn rmem wmem thp
  swappiness="$(sysctl -n vm.swappiness)"
  min_free="$(sysctl -n vm.min_free_kbytes)"
  dirty_ratio="$(sysctl -n vm.dirty_ratio)"
  dirty_bg="$(sysctl -n vm.dirty_background_ratio)"
  vfs_cache="$(sysctl -n vm.vfs_cache_pressure)"
  tcp_syn="$(sysctl -n net.ipv4.tcp_max_syn_backlog)"
  rmem="$(sysctl -n net.core.rmem_max)"
  wmem="$(sysctl -n net.core.wmem_max)"
  thp="$(get_thp_mode)"

  local zram_active climits culimit
  if zram_is_active; then zram_active=true; else zram_active=false; fi
  if compose_block_present container_limits; then climits=true; else climits=false; fi
  if compose_block_present container_ulimit; then culimit=true; else culimit=false; fi

  python3 - "$SNAPSHOT_FILE" "$swappiness" "$min_free" "$dirty_ratio" "$dirty_bg" \
    "$vfs_cache" "$tcp_syn" "$rmem" "$wmem" "$thp" "$zram_active" "$climits" "$culimit" <<'PYEOF'
import datetime
import json
import sys

(path, swappiness, min_free, dirty_ratio, dirty_bg, vfs_cache,
 tcp_syn, rmem, wmem, thp, zram_active, climits, culimit) = sys.argv[1:]

data = {
    "captured_at": datetime.datetime.now().astimezone().isoformat(),
    "vm.swappiness": swappiness,
    "vm.min_free_kbytes": min_free,
    "vm.dirty_ratio": dirty_ratio,
    "vm.dirty_background_ratio": dirty_bg,
    "vm.vfs_cache_pressure": vfs_cache,
    "net.ipv4.tcp_max_syn_backlog": tcp_syn,
    "net.core.rmem_max": rmem,
    "net.core.wmem_max": wmem,
    "thp_enabled": thp,
    "zram_active": zram_active == "true",
    "container_limits_applied": climits == "true",
    "container_ulimit_applied": culimit == "true",
}

with open(path, "w") as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PYEOF

  echo "Snapshot written to $SNAPSHOT_FILE"
}

apply_cmd() {
  local items=("${ITEM_LIST[@]}")
  if [[ -n "$ONLY_ITEM" ]]; then
    validate_item "$ONLY_ITEM"
    items=("$ONLY_ITEM")
  fi

  local touches_compose=false
  local it
  for it in "${items[@]}"; do
    if item_touches_compose "$it"; then
      touches_compose=true
    fi
  done

  if [[ "$touches_compose" == true ]]; then
    require_compose_file_exists
    backup_compose_file
  fi

  COMPOSE_CHANGED=false
  for it in "${items[@]}"; do
    echo "Applying: $it"
    apply_item "$it"
  done

  if [[ "$touches_compose" == true && "$COMPOSE_CHANGED" == true ]]; then
    restart_compose_stack
  fi

  echo "Apply complete for: ${items[*]}"
}

revert_cmd() {
  require_snapshot_exists

  local items=("${ITEM_LIST[@]}")
  if [[ -n "$ONLY_ITEM" ]]; then
    validate_item "$ONLY_ITEM"
    items=("$ONLY_ITEM")
  fi

  local touches_compose=false
  local it
  for it in "${items[@]}"; do
    if item_touches_compose "$it"; then
      touches_compose=true
    fi
  done

  if [[ "$touches_compose" == true ]]; then
    require_compose_file_exists
    backup_compose_file
  fi

  COMPOSE_CHANGED=false
  for it in "${items[@]}"; do
    echo "Reverting: $it"
    revert_item "$it"
  done

  if [[ "$touches_compose" == true && "$COMPOSE_CHANGED" == true ]]; then
    restart_compose_stack
  fi

  echo "Revert complete for: ${items[*]}"
}

SUBCOMMAND=""
ONLY_ITEM=""
COMPOSE_FILE="${COMPOSE_FILE:-/opt/app/docker-compose.yml}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -h|--help)
      print_help
      exit 0
      ;;
    --only)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --only requires an argument" >&2
        exit 1
      fi
      ONLY_ITEM="$2"
      shift 2
      ;;
    --compose-file)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --compose-file requires an argument" >&2
        exit 1
      fi
      COMPOSE_FILE="$2"
      shift 2
      ;;
    snapshot|apply|revert)
      if [[ -n "$SUBCOMMAND" ]]; then
        echo "ERROR: multiple subcommands given" >&2
        exit 1
      fi
      SUBCOMMAND="$1"
      shift
      ;;
    *)
      echo "ERROR: unknown argument '$1'" >&2
      print_help
      exit 1
      ;;
  esac
done

if [[ -z "$SUBCOMMAND" ]]; then
  print_help
  exit 1
fi

if [[ -n "$ONLY_ITEM" && "$SUBCOMMAND" == "snapshot" ]]; then
  echo "ERROR: --only is not valid with the snapshot subcommand" >&2
  exit 1
fi

require_root
require_deps

case "$SUBCOMMAND" in
  snapshot) snapshot_cmd ;;
  apply) apply_cmd ;;
  revert) revert_cmd ;;
esac
