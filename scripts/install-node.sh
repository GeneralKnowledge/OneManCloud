#!/usr/bin/env bash
# OneManCloud node installer for Ubuntu (including Oracle ARM64).
# Prefer cloning this repository and running:
#   ./scripts/install-node.sh
# Do not pipe untrusted remote scripts into bash.
set -euo pipefail

OMC_HOME="${OMC_HOME:-/opt/onemancloud}"
OMC_USER="${OMC_USER:-omc}"
CONTROL_PLANE_URL="${OMC_URL:-}"
OPERATOR_TOKEN="${OPERATOR_TOKEN:-}"
NODE_NAME="${OMC_NODE_NAME:-oracle-arm}"

echo "==> OneManCloud node installer"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Please run as root (sudo)."
  exit 1
fi

echo "==> Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl ca-certificates gnupg git jq

if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id -u "$OMC_USER" >/dev/null 2>&1; then
  useradd --system --home "$OMC_HOME" --shell /usr/sbin/nologin "$OMC_USER"
fi
usermod -aG docker "$OMC_USER" || true

echo "==> Installing agent into $OMC_HOME"
mkdir -p "$OMC_HOME"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Copy monorepo subset required by the agent
rsync -a --delete \
  --exclude node_modules \
  --exclude .git \
  --exclude .wrangler \
  "$REPO_ROOT/" "$OMC_HOME/repo/"

cd "$OMC_HOME/repo"
corepack enable || true
npm install -g pnpm@10 >/dev/null 2>&1 || true
pnpm install --frozen-lockfile=false

mkdir -p /var/lib/omc
chown -R "$OMC_USER:$OMC_USER" "$OMC_HOME" /var/lib/omc

if [[ -z "$CONTROL_PLANE_URL" || -z "$OPERATOR_TOKEN" ]]; then
  echo
  echo "Set OMC_URL and OPERATOR_TOKEN then re-run, or write /etc/omc/agent.env"
fi

mkdir -p /etc/omc
cat >/etc/omc/agent.env <<EOF
OMC_URL=${CONTROL_PLANE_URL}
OPERATOR_TOKEN=${OPERATOR_TOKEN}
OMC_NODE_NAME=${NODE_NAME}
OMC_NODE_STATE=/var/lib/omc/node.json
OMC_CONFIG=/var/lib/omc/operator.json
EOF
chmod 600 /etc/omc/agent.env
chown "$OMC_USER:$OMC_USER" /etc/omc/agent.env

# Persist operator config for first registration
if [[ -n "$CONTROL_PLANE_URL" && -n "$OPERATOR_TOKEN" ]]; then
  cat >/var/lib/omc/operator.json <<EOF
{"url":"${CONTROL_PLANE_URL}","token":"${OPERATOR_TOKEN}"}
EOF
  chmod 600 /var/lib/omc/operator.json
  chown "$OMC_USER:$OMC_USER" /var/lib/omc/operator.json
fi

cat >/etc/systemd/system/omc-agent.service <<EOF
[Unit]
Description=OneManCloud Node Agent
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=${OMC_USER}
Group=${OMC_USER}
EnvironmentFile=/etc/omc/agent.env
WorkingDirectory=${OMC_HOME}/repo/node/agent
ExecStart=/usr/bin/pnpm --filter @omc/agent start -- --name \${OMC_NODE_NAME}
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now omc-agent.service

echo
echo "==> Agent installed and started"
echo "    Service: systemctl status omc-agent"
echo "    Logs:    journalctl -u omc-agent -f"
echo "    State:   /var/lib/omc/node.json"
echo
echo "Security note: Docker access is privileged. The agent can start containers"
echo "as root inside the Docker daemon trust boundary. Treat node tokens as secrets."
echo
echo "Cloudflare Tunnel is optional for public apps. See docs/tunnel.md"
