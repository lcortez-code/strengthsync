#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUN_DIR="${PROJECT_ROOT}/.next/start-app"
PID_FILE="${RUN_DIR}/start-app.pid"
LOG_FILE="${RUN_DIR}/start-app.log"
ENV_FILE="${PROJECT_ROOT}/.env"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.yml"
APP_PORT=3000
START_TIMEOUT_SECONDS="${STRENGTHSYNC_START_TIMEOUT_SECONDS:-120}"
COMPOSE=(docker compose --project-directory "${PROJECT_ROOT}" --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

for command_name in docker node npm lsof; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "${command_name} is required to start StrengthSync." >&2
    exit 1
  fi
done

if ! node -e 'const [major, minor] = process.versions.node.split(".").map(Number); process.exit(major > 20 || (major === 20 && minor >= 6) ? 0 : 1)'; then
  echo "StrengthSync requires Node.js 20.6 or newer." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop must be running to start StrengthSync's local PostgreSQL service." >&2
  exit 1
fi

if [[ ! -d "${PROJECT_ROOT}/node_modules" ]]; then
  echo "Dependencies are not installed. Run 'npm install' in ${PROJECT_ROOT} first." >&2
  exit 1
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Missing ${ENV_FILE}. Create it from .env.example before starting StrengthSync." >&2
  exit 1
fi

if [[ ! "${START_TIMEOUT_SECONDS}" =~ ^[1-9][0-9]*$ ]]; then
  echo "STRENGTHSYNC_START_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 1
fi

if ! node --env-file="${ENV_FILE}" -e '
  const required = ["DATABASE_URL", "NEXTAUTH_URL", "NEXTAUTH_SECRET"];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required StrengthSync environment keys: ${missing.join(", ")}`);
    process.exit(1);
  }
'; then
  exit 1
fi

cd "${PROJECT_ROOT}"
unset NODE_TLS_REJECT_UNAUTHORIZED

if ! npm run db:local:guard; then
  echo "StrengthSync refused to use a non-loopback PostgreSQL database." >&2
  exit 1
fi

if ! "${COMPOSE[@]}" config --quiet; then
  echo "${COMPOSE_FILE} is not a valid Docker Compose configuration." >&2
  exit 1
fi

mkdir -p "${RUN_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  existing_pid="$(tr -d '[:space:]' < "${PID_FILE}")"
  if [[ "${existing_pid}" =~ ^[1-9][0-9]*$ ]] && kill -0 -- "-${existing_pid}" 2>/dev/null; then
    echo "StrengthSync is already running under process group ${existing_pid}. Use restart-app.sh to restart it." >&2
    exit 1
  fi
  rm -f "${PID_FILE}"
fi

if lsof -nP -iTCP:"${APP_PORT}" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port ${APP_PORT} is already in use. Stop the owning process before starting StrengthSync." >&2
  exit 1
fi

process_is_owned() {
  local process_id="$1"
  local cwd_line process_cwd

  while IFS= read -r cwd_line; do
    [[ "${cwd_line}" == n* ]] || continue
    process_cwd="${cwd_line#n}"
    [[ "${process_cwd}" == "${PROJECT_ROOT}" || "${process_cwd}" == "${PROJECT_ROOT}/"* ]] && return 0
  done < <(lsof -a -p "${process_id}" -d cwd -Fn 2>/dev/null || true)

  return 1
}

while read -r process_id command_text; do
  if [[ "${command_text}" == *"next dev"* || "${command_text}" == *"npm run dev"* ]] && process_is_owned "${process_id}"; then
    echo "A StrengthSync development server is already running outside start-app.sh." >&2
    exit 1
  fi
done < <(ps ax -o pid=,command=)

cleanup_failed_start() {
  echo "StrengthSync did not become ready. See ${LOG_FILE}." >&2
  "${PROJECT_ROOT}/stop-app.sh" >/dev/null 2>&1 || true
  exit 1
}

echo "Starting StrengthSync's loopback-only PostgreSQL container..."
if ! npm run db:local:up; then
  "${COMPOSE[@]}" down >/dev/null 2>&1 || true
  exit 1
fi

echo "Applying the local Prisma schema and idempotent reference seed..."
if ! npm run db:local:setup; then
  cleanup_failed_start
fi

echo "Starting StrengthSync on http://localhost:${APP_PORT}..."
NPM_COMMAND="$(command -v npm)"
if ! node - "${PROJECT_ROOT}" "${NPM_COMMAND}" "${LOG_FILE}" "${PID_FILE}" <<'NODE'
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const [, , projectRoot, npmCommand, logFile, pidFile] = process.argv;
const env = { ...process.env };
delete env.NODE_TLS_REJECT_UNAUTHORIZED;

const logFd = fs.openSync(logFile, 'a');
const child = spawn(npmCommand, ['run', 'dev', '--', '--hostname', '127.0.0.1'], {
  cwd: projectRoot,
  detached: true,
  env,
  stdio: ['ignore', logFd, logFd],
});

child.once('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});

child.once('spawn', () => {
  fs.writeFileSync(pidFile, `${child.pid}\n`);
  child.unref();
});
NODE
then
  cleanup_failed_start
fi

supervisor_pid="$(tr -d '[:space:]' < "${PID_FILE}" 2>/dev/null || true)"
if [[ ! "${supervisor_pid}" =~ ^[1-9][0-9]*$ ]]; then
  cleanup_failed_start
fi

deadline=$((SECONDS + START_TIMEOUT_SECONDS))
while (( SECONDS < deadline )); do
  if ! kill -0 -- "-${supervisor_pid}" 2>/dev/null; then
    cleanup_failed_start
  fi

  listener_pids="$(lsof -nP -t -iTCP:"${APP_PORT}" -sTCP:LISTEN 2>/dev/null || true)"
  for process_id in ${listener_pids}; do
    process_group="$(ps -p "${process_id}" -o pgid= 2>/dev/null | tr -d '[:space:]')"
    if [[ "${process_group}" == "${supervisor_pid}" ]]; then
      echo "StrengthSync is running at http://localhost:${APP_PORT}."
      echo "Local PostgreSQL data is stored in the preserved strengthsync-local-postgres-data volume."
      echo "Logs: ${LOG_FILE}"
      exit 0
    fi
  done

  sleep 1
done

cleanup_failed_start
