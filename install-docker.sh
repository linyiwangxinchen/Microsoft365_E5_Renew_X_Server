#!/usr/bin/env bash
set -Eeuo pipefail

# One-command Docker installer for the Node RenewX web service.
# It intentionally does not inspect, copy, or upload any local Config.cfg.

readonly DEFAULT_REPO_URL="https://github.com/linyiwangxinchen/Microsoft365_E5_Renew_X_Server.git"
readonly DEFAULT_REPO_REF="master"
readonly DEFAULT_GH_PROXY_BASE="https://gh-proxy.org"
readonly DEFAULT_INSTALL_DIR="/opt/microsoft365-e5-renewx"
readonly DEFAULT_WEB_PORT="3000"
readonly DEFAULT_CONTAINER_PORT="3000"

REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
REPO_REF="${REPO_REF:-$DEFAULT_REPO_REF}"
GH_PROXY_BASE="${GH_PROXY_BASE:-$DEFAULT_GH_PROXY_BASE}"
APP_DIR="${APP_DIR:-}"
WEB_PORT="${WEB_PORT:-}"
PORT="${PORT:-}"
ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-}"
DATA_ENCRYPTION_KEY_VALUE="${DATA_ENCRYPTION_KEY:-}"
PUBLIC_BASE_URL_VALUE="${PUBLIC_BASE_URL:-}"
INSTALL_DOCKER="${INSTALL_DOCKER:-auto}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"
WAIT_FOR_HEALTH="${WAIT_FOR_HEALTH:-1}"
DOCKER_UID="${DOCKER_UID:-}"
DOCKER_GID="${DOCKER_GID:-}"

COMPOSE_CMD=()
ENV_FILE=""

log() {
  printf '[renewx] %s\n' "$*"
}

warn() {
  printf '[renewx] WARNING: %s\n' "$*" >&2
}

die() {
  printf '[renewx] ERROR: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install-docker.sh [options]

Install or update the Node RenewX web service with Docker Compose.

Options:
  --dir PATH             Installation directory
  --web-port PORT        Host port exposed by Docker (default: 3000)
  --port PORT            Port used inside the container (default: 3000)
  --repo URL             Git repository to install
  --ref REF              Git branch or tag (default: master)
  --proxy URL            GitHub proxy prefix (default: https://gh-proxy.org)
  --no-proxy             Use GitHub directly
  --install-docker       Install Docker with get.docker.com if missing
  --no-install-docker    Fail instead of installing Docker if missing
  --non-interactive      Require ADMIN_PASSWORD when no terminal is available
  --no-wait              Do not wait for the HTTP health check
  -h, --help             Show this help

Environment variables can be used instead of options, for example:
  WEB_PORT=8080 bash install-docker.sh
  ADMIN_PASSWORD='change-me' WEB_PORT=8080 bash install-docker.sh
  GH_PROXY_BASE=https://ghproxy.net bash install-docker.sh
EOF
}

while (($# > 0)); do
  case "$1" in
    --dir)
      (($# >= 2)) || die "--dir requires a path"
      APP_DIR="$2"
      shift 2
      ;;
    --web-port)
      (($# >= 2)) || die "--web-port requires a number"
      WEB_PORT="$2"
      shift 2
      ;;
    --port)
      (($# >= 2)) || die "--port requires a number"
      PORT="$2"
      shift 2
      ;;
    --repo)
      (($# >= 2)) || die "--repo requires a URL"
      REPO_URL="$2"
      shift 2
      ;;
    --ref)
      (($# >= 2)) || die "--ref requires a branch or tag"
      REPO_REF="$2"
      shift 2
      ;;
    --proxy)
      (($# >= 2)) || die "--proxy requires a URL"
      GH_PROXY_BASE="${2%/}"
      shift 2
      ;;
    --no-proxy)
      GH_PROXY_BASE=""
      shift
      ;;
    --install-docker)
      INSTALL_DOCKER=1
      shift
      ;;
    --no-install-docker)
      INSTALL_DOCKER=0
      shift
      ;;
    --non-interactive)
      NON_INTERACTIVE=1
      shift
      ;;
    --no-wait)
      WAIT_FOR_HEALTH=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      die "unknown option: $1 (use --help for usage)"
      ;;
  esac
done

if [[ -z "$APP_DIR" ]]; then
  if [[ -f "$PWD/node-renewx/docker-compose.yml" && -f "$PWD/node-renewx/Dockerfile" ]]; then
    APP_DIR="$PWD"
  elif [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    APP_DIR="$DEFAULT_INSTALL_DIR"
  else
    APP_DIR="${HOME:-/tmp}/microsoft365-e5-renewx"
  fi
fi

APP_DIR="${APP_DIR%/}"
[[ -n "$APP_DIR" && "$APP_DIR" != "/" ]] || die "invalid installation directory"

if [[ -z "$DOCKER_UID" || -z "$DOCKER_GID" ]]; then
  if [[ -n "${SUDO_UID:-}" && -n "${SUDO_GID:-}" ]]; then
    DOCKER_UID="$SUDO_UID"
    DOCKER_GID="$SUDO_GID"
  elif [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    # The official node image uses uid/gid 1000. This keeps bind-mounted SQLite
    # data writable when the installer is run by root.
    DOCKER_UID=1000
    DOCKER_GID=1000
  else
    DOCKER_UID="$(id -u)"
    DOCKER_GID="$(id -g)"
  fi
fi

is_interactive() {
  [[ "$NON_INTERACTIVE" != 1 ]] && { [[ -t 0 ]] || [[ -r /dev/tty ]]; }
}

ask_line() {
  local prompt="$1"
  local default_value="${2:-}"
  local answer=""
  if [[ -r /dev/tty && ! -t 0 ]]; then
    if [[ -n "$default_value" ]]; then
      read -r -p "$prompt [$default_value]: " answer </dev/tty || true
    else
      read -r -p "$prompt: " answer </dev/tty || true
    fi
  elif [[ -t 0 ]]; then
    if [[ -n "$default_value" ]]; then
      read -r -p "$prompt [$default_value]: " answer || true
    else
      read -r -p "$prompt: " answer || true
    fi
  fi
  printf '%s' "${answer:-$default_value}"
}

ask_secret() {
  local prompt="$1"
  local answer=""
  local confirm=""
  if [[ -r /dev/tty && ! -t 0 ]]; then
    read -r -s -p "$prompt: " answer </dev/tty || true
    printf '\n' >&2
    read -r -s -p "Confirm: " confirm </dev/tty || true
    printf '\n' >&2
  elif [[ -t 0 ]]; then
    read -r -s -p "$prompt: " answer || true
    printf '\n' >&2
    read -r -s -p "Confirm: " confirm || true
    printf '\n' >&2
  fi
  [[ -n "$answer" ]] || die "secret cannot be empty"
  [[ "$answer" == "$confirm" ]] || die "secret confirmation did not match"
  [[ "$answer" != *$'\n'* && "$answer" != *$'\r'* ]] || die "secret cannot contain a newline"
  printf '%s' "$answer"
}

valid_port() {
  [[ "$1" =~ ^[0-9]+$ ]] && ((10#$1 >= 1 && 10#$1 <= 65535))
}

command_exists() {
  command -v "$1" >/dev/null 2>&1
}

proxy_url() {
  local url="$1"
  if [[ -z "$GH_PROXY_BASE" ]]; then
    printf '%s' "$url"
  else
    printf '%s/%s' "${GH_PROXY_BASE%/}" "$url"
  fi
}

git_proxy_config() {
  if [[ -z "$GH_PROXY_BASE" ]]; then
    return 0
  fi
  printf '%s' "url.${GH_PROXY_BASE%/}/https://github.com/.insteadOf=https://github.com/"
}

as_root() {
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    "$@"
  elif command_exists sudo; then
    sudo "$@"
  else
    die "root privileges are required for: $*"
  fi
}

read_env_value() {
  local key="$1"
  local value=""
  if [[ -f "$ENV_FILE" ]]; then
    value="$(sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 || true)"
  fi
  printf '%s' "$value"
}

set_env_value() {
  local key="$1"
  local value="$2"
  local temp_file
  temp_file="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  {
    grep -v "^${key}=" "$ENV_FILE" || true
    printf '%s=%s\n' "$key" "$value"
  } > "$temp_file"
  chmod 600 "$temp_file"
  mv "$temp_file" "$ENV_FILE"
}

random_secret() {
  if command_exists openssl; then
    openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-64
  else
    od -An -N48 -tx1 /dev/urandom | tr -d ' \n' | cut -c1-64
  fi
}

ensure_basic_tools() {
  command_exists curl || die "curl is required; install curl and run this script again"
  command_exists tar || die "tar is required; install tar and run this script again"
}

docker_available() {
  command_exists docker && docker compose version >/dev/null 2>&1
}

select_docker_command() {
  if command_exists docker && docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(docker compose)
    return 0
  fi
  if command_exists sudo && sudo docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD=(sudo docker compose)
    return 0
  fi
  return 1
}

ensure_docker() {
  if select_docker_command; then
    return 0
  fi

  local should_install=0
  if [[ "$INSTALL_DOCKER" == 1 ]]; then
    should_install=1
  elif [[ "$INSTALL_DOCKER" == 0 || "$NON_INTERACTIVE" == 1 ]]; then
    should_install=0
  elif is_interactive; then
    local answer
    answer="$(ask_line 'Docker Compose plugin not found. Install Docker now? [y/N]' '')"
    [[ "$answer" =~ ^[Yy]([Ee][Ss])?$ ]] && should_install=1
  fi

  if ((should_install == 0)); then
    die "Docker Compose plugin is required. Install Docker, or rerun with --install-docker"
  fi

  log "Installing Docker using the official installer"
  curl -fsSL https://get.docker.com | as_root sh
  if command_exists systemctl; then
    as_root systemctl enable --now docker || true
  fi
  select_docker_command || die "Docker installed, but 'docker compose' is still unavailable"
}

clone_repository() {
  local parent
  parent="$(dirname "$APP_DIR")"
  mkdir -p "$parent"

  if command_exists git; then
    log "Cloning $REPO_URL ($REPO_REF)"
    local git_proxy
    git_proxy="$(git_proxy_config)"
    if [[ -n "$git_proxy" ]]; then
      git -c "$git_proxy" clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
    else
      git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$APP_DIR"
    fi
    return 0
  fi

  [[ "$REPO_URL" =~ ^https://github\.com/[^/]+/[^/]+(\.git)?$ ]] || die "git is unavailable and the repository URL is not a GitHub HTTPS URL"
  local archive_base="${REPO_URL%.git}"
  local temp_dir extracted
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN
  log "git is unavailable; downloading the GitHub source archive"
  curl -fsSL "$(proxy_url "${archive_base}/archive/refs/heads/${REPO_REF}.tar.gz")" -o "$temp_dir/source.tar.gz"
  tar -xzf "$temp_dir/source.tar.gz" -C "$temp_dir"
  extracted="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [[ -n "$extracted" ]] || die "unable to unpack the repository archive"
  mv "$extracted" "$APP_DIR"
  trap - RETURN
  rm -rf "$temp_dir"
}

refresh_archive_source() {
  local archive_base="${REPO_URL%.git}"
  local temp_dir extracted preserved_env preserved_data
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' RETURN
  log "Updating source from the GitHub archive"
  curl -fsSL "$(proxy_url "${archive_base}/archive/refs/heads/${REPO_REF}.tar.gz")" -o "$temp_dir/source.tar.gz"
  tar -xzf "$temp_dir/source.tar.gz" -C "$temp_dir"
  extracted="$(find "$temp_dir" -mindepth 1 -maxdepth 1 -type d -print -quit)"
  [[ -n "$extracted" && -f "$extracted/node-renewx/docker-compose.yml" ]] || die "unable to unpack a valid RenewX source archive"

  preserved_env="$temp_dir/preserved.env"
  preserved_data="$temp_dir/preserved-data"
  if [[ -f "$APP_DIR/node-renewx/.env" ]]; then
    cp "$APP_DIR/node-renewx/.env" "$preserved_env"
    cp "$preserved_env" "$extracted/node-renewx/.env"
  fi
  if [[ -d "$APP_DIR/node-renewx/data" ]]; then
    cp -a "$APP_DIR/node-renewx/data" "$preserved_data"
    rm -rf "$extracted/node-renewx/data"
    cp -a "$preserved_data" "$extracted/node-renewx/data"
  fi
  cp -a "$extracted/." "$APP_DIR/"
  trap - RETURN
  rm -rf "$temp_dir"
}

prepare_source() {
  if [[ -f "$APP_DIR/node-renewx/docker-compose.yml" && -f "$APP_DIR/node-renewx/Dockerfile" ]]; then
    if [[ -d "$APP_DIR/.git" && "${UPDATE_EXISTING:-1}" == 1 ]]; then
      if [[ -n "$(git -C "$APP_DIR" status --porcelain --untracked-files=no)" ]]; then
        die "existing source has local tracked changes; commit or stash them before updating"
      fi
      log "Updating existing source"
      local git_proxy
      git_proxy="$(git_proxy_config)"
      if [[ -n "$git_proxy" ]]; then
        git -C "$APP_DIR" -c "$git_proxy" fetch --depth 1 "$REPO_URL" "$REPO_REF"
      else
        git -C "$APP_DIR" fetch --depth 1 "$REPO_URL" "$REPO_REF"
      fi
      git -C "$APP_DIR" merge --ff-only FETCH_HEAD
    elif [[ "${UPDATE_EXISTING:-1}" == 1 ]]; then
      refresh_archive_source
    else
      log "Using existing source at $APP_DIR"
    fi
    return 0
  fi

  if [[ -e "$APP_DIR" ]]; then
    die "$APP_DIR exists but is not a RenewX source directory"
  fi
  clone_repository
}

prepare_env() {
  ENV_FILE="$APP_DIR/node-renewx/.env"
  local example_file="$APP_DIR/node-renewx/.env.example"
  [[ -f "$example_file" ]] || die "missing $example_file"
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$example_file" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
  else
    chmod 600 "$ENV_FILE"
  fi

  local existing_web_port existing_container_port existing_admin existing_key existing_url
  existing_web_port="$(read_env_value WEB_PORT)"
  existing_container_port="$(read_env_value PORT)"
  existing_admin="$(read_env_value ADMIN_PASSWORD)"
  existing_key="$(read_env_value DATA_ENCRYPTION_KEY)"
  existing_url="$(read_env_value PUBLIC_BASE_URL)"

  local requested_web_port="$WEB_PORT"
  if [[ -z "$requested_web_port" && -z "$existing_web_port" ]] && is_interactive; then
    WEB_PORT="$(ask_line 'Host port' "$DEFAULT_WEB_PORT")"
  else
    WEB_PORT="${requested_web_port:-${existing_web_port:-$DEFAULT_WEB_PORT}}"
  fi
  valid_port "$WEB_PORT" || die "invalid host port: $WEB_PORT"

  [[ -n "$PORT" ]] || PORT="${existing_container_port:-$DEFAULT_CONTAINER_PORT}"
  valid_port "$PORT" || die "invalid container port: $PORT"

  if [[ -z "$ADMIN_PASSWORD_VALUE" || "$ADMIN_PASSWORD_VALUE" == "change-this-password" ]]; then
    ADMIN_PASSWORD_VALUE="$existing_admin"
  fi
  if [[ -z "$ADMIN_PASSWORD_VALUE" || "$ADMIN_PASSWORD_VALUE" == "change-this-password" ]]; then
    if is_interactive; then
      ADMIN_PASSWORD_VALUE="$(ask_secret 'Web administrator password')"
    else
      die "ADMIN_PASSWORD is required in non-interactive mode"
    fi
  fi

  if [[ -z "$DATA_ENCRYPTION_KEY_VALUE" || "$DATA_ENCRYPTION_KEY_VALUE" == "change-this-encryption-key" ]]; then
    DATA_ENCRYPTION_KEY_VALUE="$existing_key"
  fi
  if [[ -z "$DATA_ENCRYPTION_KEY_VALUE" || "$DATA_ENCRYPTION_KEY_VALUE" == "change-this-encryption-key" ]]; then
    DATA_ENCRYPTION_KEY_VALUE="$(random_secret)"
  fi

  if [[ -z "$PUBLIC_BASE_URL_VALUE" ]]; then
    PUBLIC_BASE_URL_VALUE="$existing_url"
  fi
  if [[ -z "$PUBLIC_BASE_URL_VALUE" || "$PUBLIC_BASE_URL_VALUE" == "http://localhost:3000" ]]; then
    PUBLIC_BASE_URL_VALUE="http://localhost:${WEB_PORT}"
  fi

  set_env_value NODE_ENV production
  set_env_value HOST 0.0.0.0
  set_env_value PORT "$PORT"
  set_env_value WEB_PORT "$WEB_PORT"
  set_env_value DATA_DIR /data
  set_env_value ADMIN_PASSWORD "$ADMIN_PASSWORD_VALUE"
  set_env_value DATA_ENCRYPTION_KEY "$DATA_ENCRYPTION_KEY_VALUE"
  set_env_value PUBLIC_BASE_URL "$PUBLIC_BASE_URL_VALUE"
  set_env_value DOCKER_UID "$DOCKER_UID"
  set_env_value DOCKER_GID "$DOCKER_GID"
}

prepare_data_directory() {
  local data_dir="$APP_DIR/node-renewx/data"
  mkdir -p "$data_dir"
  if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
    chown -R "${DOCKER_UID}:${DOCKER_GID}" "$data_dir"
  else
    chmod 700 "$data_dir"
  fi
}

wait_for_health() {
  [[ "$WAIT_FOR_HEALTH" == 1 ]] || return 0
  command_exists curl || return 0
  local url="http://127.0.0.1:${WEB_PORT}/api/health"
  local attempt
  for attempt in $(seq 1 60); do
    if curl -fsS --max-time 3 "$url" >/dev/null 2>&1; then
      log "Health check passed: $url"
      return 0
    fi
    sleep 2
  done
  warn "Health check did not pass within 120 seconds"
  "${COMPOSE_CMD[@]}" -f "$APP_DIR/node-renewx/docker-compose.yml" --env-file "$ENV_FILE" ps || true
  return 1
}

main() {
  umask 077
  ensure_basic_tools
  ensure_docker
  prepare_source
  prepare_env
  prepare_data_directory

  log "Building and starting the service"
  "${COMPOSE_CMD[@]}" -f "$APP_DIR/node-renewx/docker-compose.yml" --env-file "$ENV_FILE" up -d --build
  wait_for_health || die "container started, but the health check failed; inspect logs with: ${COMPOSE_CMD[*]} -f $APP_DIR/node-renewx/docker-compose.yml logs --tail=100"

  cat <<EOF

RenewX Docker installation is ready.

  URL:       http://127.0.0.1:${WEB_PORT}
  Directory: ${APP_DIR}
  Env file:  ${ENV_FILE}
  Data:      ${APP_DIR}/node-renewx/data
  Proxy:     ${GH_PROXY_BASE:-disabled}

Useful commands:
  ${COMPOSE_CMD[*]} -f ${APP_DIR}/node-renewx/docker-compose.yml --env-file ${ENV_FILE} ps
  ${COMPOSE_CMD[*]} -f ${APP_DIR}/node-renewx/docker-compose.yml --env-file ${ENV_FILE} logs -f
  ${COMPOSE_CMD[*]} -f ${APP_DIR}/node-renewx/docker-compose.yml --env-file ${ENV_FILE} restart

Change the host port later by editing WEB_PORT in ${ENV_FILE}, then run:
  ${COMPOSE_CMD[*]} -f ${APP_DIR}/node-renewx/docker-compose.yml --env-file ${ENV_FILE} up -d
EOF
}

main "$@"
