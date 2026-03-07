#!/bin/bash
# ============ JARVIS VPS Deployment Script ============
# One-shot provisioning for Hetzner CX31 (or any Ubuntu 22.04+ VPS).
#
# Usage:
#   scp scripts/vps-deploy.sh root@YOUR_VPS_IP:~/
#   ssh root@YOUR_VPS_IP
#   chmod +x vps-deploy.sh
#   ./vps-deploy.sh
#
# What this does:
#   1. System updates + security hardening
#   2. Install Docker + Docker Compose
#   3. Firewall (ufw) — only 22, 80, 443
#   4. Clone repo + set up .env
#   5. Generate self-signed certs (replace with Let's Encrypt)
#   6. Build and start the stack
#   7. Set up automated backups (cron)
#
# Estimated time: ~5 minutes on CX31
# ============

set -euo pipefail

# ============ Config ============
JARVIS_USER="jarvis"
JARVIS_HOME="/home/$JARVIS_USER"
REPO_URL="${GITHUB_REPO_URL:-https://github.com/WGlynn/vibeswap-private.git}"
DOMAIN="${JARVIS_DOMAIN:-}"  # Set this for Let's Encrypt SSL

echo "============================================"
echo "  JARVIS VPS Deployment"
echo "  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# ============ 1. System Setup ============
echo "[1/7] System updates..."
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    curl git ufw fail2ban unattended-upgrades apt-transport-https \
    ca-certificates gnupg lsb-release jq

# Enable automatic security updates
dpkg-reconfigure -plow unattended-upgrades 2>/dev/null || true

echo "  System updated."

# ============ 2. Docker ============
echo "[2/7] Installing Docker..."
if ! command -v docker &>/dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
    echo "  Docker installed."
else
    echo "  Docker already installed."
fi

# ============ 3. Firewall ============
echo "[3/7] Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable
echo "  Firewall active: SSH(22), HTTP(80), HTTPS(443)"

# ============ 4. Create jarvis user ============
echo "[4/7] Setting up jarvis user..."
if ! id "$JARVIS_USER" &>/dev/null; then
    useradd -m -s /bin/bash "$JARVIS_USER"
    usermod -aG docker "$JARVIS_USER"
    echo "  User '$JARVIS_USER' created + added to docker group."
else
    usermod -aG docker "$JARVIS_USER" 2>/dev/null || true
    echo "  User '$JARVIS_USER' already exists."
fi

# ============ 5. Clone Repo ============
echo "[5/7] Cloning repository..."
DEPLOY_DIR="$JARVIS_HOME/vibeswap"

if [ -d "$DEPLOY_DIR/.git" ]; then
    echo "  Repo exists — pulling latest..."
    cd "$DEPLOY_DIR"
    git pull origin master || echo "  Pull failed, using existing."
else
    if [ -n "${GITHUB_TOKEN:-}" ]; then
        CLONE_URL="https://${GITHUB_TOKEN}@${REPO_URL#https://}"
    else
        CLONE_URL="$REPO_URL"
    fi
    git clone "$CLONE_URL" "$DEPLOY_DIR"
    echo "  Repo cloned to $DEPLOY_DIR"
fi

chown -R "$JARVIS_USER:$JARVIS_USER" "$DEPLOY_DIR"
cd "$DEPLOY_DIR/jarvis-bot"

# ============ 6. Environment + Certs ============
echo "[6/7] Setting up environment..."

# Create .env from example if not exists
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "  Created .env from example — EDIT THIS FILE with your secrets!"
        echo ""
        echo "  REQUIRED secrets to set in $DEPLOY_DIR/jarvis-bot/.env:"
        echo "    TELEGRAM_BOT_TOKEN=..."
        echo "    GITHUB_TOKEN=..."
        echo "    GROQ_API_KEY=...       (free tier: 14K req/day)"
        echo "    DEEPSEEK_API_KEY=...   (cheap fallback)"
        echo "    CEREBRAS_API_KEY=...   (free tier: 1M tokens/day)"
        echo ""
    fi
else
    echo "  .env already exists."
fi

# SSL certificates
mkdir -p nginx/certs

if [ -n "$DOMAIN" ]; then
    echo "  Setting up Let's Encrypt for $DOMAIN..."
    # Install certbot
    apt-get install -y -qq certbot
    # Get cert (standalone mode — nginx not running yet)
    certbot certonly --standalone -d "$DOMAIN" --non-interactive --agree-tos \
        --email "jarvis@vibeswap.io" || {
        echo "  Certbot failed — falling back to self-signed certs."
        DOMAIN=""
    }
    if [ -n "$DOMAIN" ]; then
        ln -sf "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" nginx/certs/fullchain.pem
        ln -sf "/etc/letsencrypt/live/$DOMAIN/privkey.pem" nginx/certs/privkey.pem
        # Auto-renew cron
        echo "0 3 * * * certbot renew --quiet --deploy-hook 'docker restart jarvis-nginx'" \
            | crontab -u root -
        echo "  Let's Encrypt configured with auto-renewal."
    fi
fi

if [ -z "$DOMAIN" ]; then
    # Self-signed fallback
    if [ ! -f nginx/certs/fullchain.pem ]; then
        echo "  Generating self-signed SSL certs (replace with Let's Encrypt later)..."
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout nginx/certs/privkey.pem \
            -out nginx/certs/fullchain.pem \
            -subj "/CN=jarvis.local" 2>/dev/null
        echo "  Self-signed certs generated."
    fi
fi

# ============ 7. Build & Start ============
echo "[7/7] Building and starting JARVIS..."

# Create data directories
mkdir -p data

# Build and start
docker compose -f docker-compose.vps.yml up -d --build

echo ""
echo "============================================"
echo "  JARVIS VPS Deployment Complete!"
echo "============================================"
echo ""
echo "  Stack:    docker compose -f docker-compose.vps.yml"
echo "  Logs:     docker compose -f docker-compose.vps.yml logs -f"
echo "  Restart:  docker compose -f docker-compose.vps.yml restart"
echo "  Stop:     docker compose -f docker-compose.vps.yml down"
echo ""
echo "  Health:   curl http://localhost/health"
echo ""
echo "  Secrets:  $DEPLOY_DIR/jarvis-bot/.env"
echo "  Nginx:    $DEPLOY_DIR/jarvis-bot/nginx/nginx.conf"
echo "  Certs:    $DEPLOY_DIR/jarvis-bot/nginx/certs/"
echo ""

# ============ Backup Cron ============
BACKUP_SCRIPT="$DEPLOY_DIR/jarvis-bot/scripts/vps-backup.sh"
if [ -f "$BACKUP_SCRIPT" ]; then
    chmod +x "$BACKUP_SCRIPT"
    # Run backup every 6 hours
    (crontab -u "$JARVIS_USER" -l 2>/dev/null || true; \
     echo "0 */6 * * * $BACKUP_SCRIPT >> /var/log/jarvis-backup.log 2>&1") \
     | sort -u | crontab -u "$JARVIS_USER" -
    echo "  Backup cron: every 6 hours"
fi

echo ""
echo "  NEXT STEPS:"
echo "  1. Edit .env with your API keys"
echo "  2. docker compose -f docker-compose.vps.yml restart"
echo "  3. Test: curl https://YOUR_IP/health (or https://$DOMAIN/health)"
echo ""
