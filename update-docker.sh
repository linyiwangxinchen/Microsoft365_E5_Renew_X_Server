#!/usr/bin/env bash
set -Eeuo pipefail

# One-command updater for an existing RenewX Docker deployment.
# It delegates to install-docker.sh, which preserves node-renewx/.env and
# node-renewx/data while refreshing source and rebuilding the container.
readonly DEFAULT_REPO_URL="https://github.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server.git"
readonly DEFAULT_REPO_REF="master"
readonly DEFAULT_GH_PROXY_BASE="https://gh-proxy.org"
readonly DEFAULT_INSTALL_DIR="/opt/microsoft365-e5-renewx"

APP_DIR="${APP_DIR:-}"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
REPO_REF="${REPO_REF:-$DEFAULT_REPO_REF}"
GH_PROXY_BASE="${GH_PROXY_BASE:-$DEFAULT_GH_PROXY_BASE}"
NO_WAIT=0

if [[ -z "$APP_DIR" ]]; then
  if [[ -f "$PWD/node-renewx/docker-compose.yml" && -f "$PWD/node-renewx/Dockerfile" ]]; then
    APP_DIR="$PWD"
  else
    APP_DIR="$DEFAULT_INSTALL_DIR"
  fi
fi

usage() {
  cat <<'EOF'
Usage: update-docker.sh [options]

Update an existing RenewX Docker deployment and rebuild the container.
The existing .env and node-renewx/data are preserved.

Options:
  --dir PATH       Existing installation directory
  --repo URL       Git repository to update
  --ref REF        Branch or tag to update from (default: master)
  --proxy URL      GitHub proxy prefix (default: https://gh-proxy.org)
  --no-proxy       Use GitHub directly
  --no-wait        Do not wait for the health check
  -h, --help       Show this help
EOF
}

while (($# > 0)); do
  case "$1" in
    --dir)
      (($# >= 2)) || { printf 'ERROR: --dir requires a path\n' >&2; exit 2; }
      APP_DIR="$2"; shift 2 ;;
    --repo)
      (($# >= 2)) || { printf 'ERROR: --repo requires a URL\n' >&2; exit 2; }
      REPO_URL="$2"; shift 2 ;;
    --ref)
      (($# >= 2)) || { printf 'ERROR: --ref requires a branch or tag\n' >&2; exit 2; }
      REPO_REF="$2"; shift 2 ;;
    --proxy)
      (($# >= 2)) || { printf 'ERROR: --proxy requires a URL\n' >&2; exit 2; }
      GH_PROXY_BASE="${2%/}"; shift 2 ;;
    --no-proxy)
      GH_PROXY_BASE=""; shift ;;
    --no-wait)
      NO_WAIT=1; shift ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      printf 'ERROR: unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ -z "$GH_PROXY_BASE" ]]; then
  args=(--dir "$APP_DIR" --repo "$REPO_URL" --ref "$REPO_REF" --no-proxy)
else
  args=(--dir "$APP_DIR" --repo "$REPO_URL" --ref "$REPO_REF" --proxy "$GH_PROXY_BASE")
fi
((NO_WAIT == 1)) && args+=(--no-wait)

if [[ -f "$(dirname "$0")/install-docker.sh" ]]; then
  exec bash "$(dirname "$0")/install-docker.sh" --no-install-docker "${args[@]}"
fi

# Supports: curl -fsSL .../update-docker.sh | sudo bash
if [[ -n "$GH_PROXY_BASE" ]]; then
  installer_url="${GH_PROXY_BASE%/}/https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh"
else
  installer_url="https://raw.githubusercontent.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server/master/install-docker.sh"
fi
curl -fsSL "$installer_url" | bash -s -- --no-install-docker "${args[@]}"
