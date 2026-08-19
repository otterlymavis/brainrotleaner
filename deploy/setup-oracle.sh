#!/usr/bin/env bash
# Provisions FocusVid Reader on a fresh Oracle Cloud Always Free VM (Ubuntu, ARM or x86).
# Run once as the default 'ubuntu' user:
#   bash deploy/setup-oracle.sh
set -euo pipefail

APP_DIR="/opt/focusvid"
DATA_DIR="/opt/focusvid-data"
REPO="${REPO:-}"

echo "==> Installing system packages"
sudo apt-get update
# fonts-dejavu-core matters: ffmpeg's drawtext needs a real font file, and a bare
# VM has none, which makes captions fail to render.
sudo apt-get install -y ffmpeg fonts-dejavu-core git curl ca-certificates

if ! command -v node >/dev/null 2>&1; then
  echo "==> Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "==> Node $(node --version), ffmpeg $(ffmpeg -version | head -n1 | cut -d' ' -f3)"

if [ ! -d "$APP_DIR" ]; then
  if [ -z "$REPO" ]; then
    echo "Set REPO to your git remote first, e.g.:"
    echo "  REPO=https://github.com/you/adhdreader.git bash deploy/setup-oracle.sh"
    exit 1
  fi
  sudo mkdir -p "$APP_DIR"
  sudo chown "$USER:$USER" "$APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi

sudo mkdir -p "$DATA_DIR"
sudo chown "$USER:$USER" "$DATA_DIR"

cd "$APP_DIR"
echo "==> Installing dependencies and building the frontend"
npm ci
npm run build

if [ ! -f "$APP_DIR/.env" ]; then
  PASSWORD="$(head -c 18 /dev/urandom | base64 | tr -d '/+=' | head -c 20)"
  cat > "$APP_DIR/.env" <<EOF
APP_PASSWORD=$PASSWORD
DATA_DIR=$DATA_DIR
HOST=127.0.0.1
PORT=8787
FFMPEG_PATH=/usr/bin/ffmpeg
EOF
  echo "==> Generated $APP_DIR/.env with password: $PASSWORD"
  echo "    Save that password now."
fi

echo "==> Installing the systemd service"
sudo cp "$APP_DIR/deploy/focusvid.service" /etc/systemd/system/focusvid.service
sudo systemctl daemon-reload
sudo systemctl enable --now focusvid

sleep 3
if curl -fsS http://127.0.0.1:8787/api/health >/dev/null; then
  echo "==> FocusVid is running. Check status with: systemctl status focusvid"
else
  echo "==> Health check failed. Inspect logs with: journalctl -u focusvid -n 50"
  exit 1
fi

cat <<'EOF'

Next: put HTTPS in front of it. HOST is bound to 127.0.0.1 so the app is not
exposed directly - the reverse proxy is what the internet talks to.

  sudo apt-get install -y caddy
  sudo cp /opt/focusvid/deploy/Caddyfile /etc/caddy/Caddyfile
  sudo nano /etc/caddy/Caddyfile     # set your hostname
  sudo systemctl restart caddy

Then open ports 80 and 443 in BOTH places, or nothing will reach the VM:
  1. Oracle Console: VCN > Security List > add ingress rules for 80 and 443
  2. On the VM: sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
                sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
                sudo netfilter-persistent save
EOF
