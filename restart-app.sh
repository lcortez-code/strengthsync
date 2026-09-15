#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

"${PROJECT_ROOT}/stop-app.sh"
exec "${PROJECT_ROOT}/start-app.sh"
