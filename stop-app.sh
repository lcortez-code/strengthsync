#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${PROJECT_ROOT}/.next/start-app/start-app.pid"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
STOP_TIMEOUT_SECONDS="${STRENGTHSYNC_STOP_TIMEOUT_SECONDS:-15}"
COMPOSE=(docker compose --project-directory "${PROJECT_ROOT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

if [[ ! "${STOP_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "STRENGTHSYNC_STOP_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 1
fi

group_is_running() {
  local process_group="$1"
  kill -0 -- "-${process_group}" 2>/dev/null
}

wait_for_group() {
  local process_group="$1"
  local deadline=$((SECONDS + STOP_TIMEOUT_SECONDS))

  while group_is_running "${process_group}" && (( SECONDS < deadline )); do
    sleep 1
  done

  ! group_is_running "${process_group}"
}

group_is_owned() {
  local process_group="$1"
  local group_commands process_id cwd_line process_cwd

  group_commands="$(ps ax -o pgid=,command= | awk -v pgid="${process_group}" '$1 == pgid { $1=""; sub(/^ /, ""); print }')"
  if grep -F "${PROJECT_ROOT}" <<< "${group_commands}" >/dev/null 2>&1; then
    return 0
  fi

  command -v lsof >/dev/null 2>&1 || return 1
  while read -r process_id; do
    while IFS= read -r cwd_line; do
      [[ "${cwd_line}" == n* ]] || continue
      process_cwd="${cwd_line#n}"
      if [[ "${process_cwd}" == "${PROJECT_ROOT}" || "${process_cwd}" == "${PROJECT_ROOT}/"* ]]; then
        return 0
      fi
    done < <(lsof -a -p "${process_id}" -d cwd -Fn 2>/dev/null || true)
  done < <(ps ax -o pid=,pgid= | awk -v pgid="${process_group}" '$2 == pgid { print $1 }')

  return 1
}

add_group() {
  local candidate="$1"
  local existing

  [[ "${candidate}" =~ ^[1-9][0-9]*$ ]] || return
  for existing in "${native_groups[@]:-}"; do
    [[ "${existing}" == "${candidate}" ]] && return
  done
  native_groups+=("${candidate}")
}

native_groups=()
if [[ -f "${PID_FILE}" ]]; then
  tracked_pid="$(tr -d '[:space:]' < "${PID_FILE}")"
  if [[ ! "${tracked_pid}" =~ ^[1-9][0-9]*$ ]]; then
    echo "Invalid StrengthSync PID file: ${PID_FILE}. Refusing to stop an unknown process." >&2
    exit 1
  fi
  if group_is_running "${tracked_pid}"; then
    add_group "${tracked_pid}"
  else
    rm -f "${PID_FILE}"
  fi
fi

while read -r process_group command_text; do
  if [[ "${command_text}" == *"next dev"* || "${command_text}" == *"npm run dev"* ]] && group_is_owned "${process_group}"; then
    add_group "${process_group}"
  fi
done < <(ps ax -o pgid=,command=)

for process_group in "${native_groups[@]:-}"; do
  [[ -n "${process_group}" ]] || continue
  if ! group_is_owned "${process_group}"; then
    echo "Process group ${process_group} is not owned by StrengthSync. Refusing to stop it." >&2
    exit 1
  fi

  echo "Stopping StrengthSync process group ${process_group}..."
  kill -TERM -- "-${process_group}"
  if ! wait_for_group "${process_group}"; then
    echo "StrengthSync did not stop within ${STOP_TIMEOUT_SECONDS} seconds; forcing its process group to exit." >&2
    kill -KILL -- "-${process_group}"
    if ! wait_for_group "${process_group}"; then
      echo "StrengthSync process group ${process_group} is still running." >&2
      exit 1
    fi
  fi
done

rm -f "${PID_FILE}"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required to verify and stop StrengthSync's PostgreSQL service." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop is not running; StrengthSync container shutdown could not be verified." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}; StrengthSync container shutdown could not be scoped safely." >&2
  exit 1
fi

echo "Stopping StrengthSync's local PostgreSQL container..."
"${COMPOSE[@]}" down
echo "StrengthSync is stopped. The strengthsync-local-postgres-data volume was preserved."
