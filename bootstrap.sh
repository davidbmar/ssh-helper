#!/bin/bash
set -euo pipefail

# SSH Helper Bootstrap Script
# Sets up the web-based SSH terminal application

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[SSH-HELPER]${NC} $1"
}

error() {
    echo -e "${RED}[SSH-HELPER ERROR]${NC} $1"
    exit 1
}

warn() {
    echo -e "${YELLOW}[SSH-HELPER WARNING]${NC} $1"
}

info() {
    echo -e "${BLUE}[SSH-HELPER INFO]${NC} $1"
}

check_dependencies() {
    log "Checking dependencies..."

    if ! command -v node &> /dev/null; then
        error "Node.js is not installed. Please install Node.js first."
    fi

    if ! command -v npm &> /dev/null; then
        error "npm is not installed. Please install npm first."
    fi

    NODE_VERSION=$(node --version)
    NPM_VERSION=$(npm --version)

    info "Node.js version: $NODE_VERSION"
    info "npm version: $NPM_VERSION"
}

install_dependencies() {
    log "Installing Node.js dependencies..."

    cd "$SCRIPT_DIR"

    if [ ! -d "node_modules" ]; then
        npm install
        log "Node.js dependencies installed"
    else
        log "Node.js dependencies already installed"
    fi
}

create_config() {
    log "Checking configuration..."

    if [ ! -f "$SCRIPT_DIR/config.json" ]; then
        log "Creating default config.json..."
        cat > "$SCRIPT_DIR/config.json" <<'EOF'
{
  "allowAll": true,
  "ipWhitelist": [],
  "shell": "/bin/bash",
  "terminalCols": 120,
  "terminalRows": 30
}
EOF
        log "Default config.json created"
    else
        log "config.json already exists"
    fi
}

install_systemd_service() {
    log "Installing systemd service..."

    if [ ! -f "$SCRIPT_DIR/systemd/ssh-helper.service.template" ]; then
        error "Service template not found at $SCRIPT_DIR/systemd/ssh-helper.service.template"
    fi

    # Replace template variables
    sed "s|{{WORKING_DIRECTORY}}|$SCRIPT_DIR|g" \
        "$SCRIPT_DIR/systemd/ssh-helper.service.template" | \
        sudo tee /etc/systemd/system/ssh-helper.service > /dev/null

    sudo systemctl daemon-reload
    sudo systemctl enable ssh-helper

    log "Systemd service installed"
}

install_nginx_configs() {
    log "Installing nginx configurations..."

    # Check if nginx include directories exist
    if [ ! -d "/etc/nginx/conf.d/system-upstreams" ]; then
        error "Nginx include directory not found. Run auth gateway bootstrap first."
    fi

    # Copy upstream config
    sudo cp "$SCRIPT_DIR/nginx/upstream.conf" \
        /etc/nginx/conf.d/system-upstreams/ssh-helper.conf

    # Copy routes config
    sudo cp "$SCRIPT_DIR/nginx/routes.conf" \
        /etc/nginx/conf.d/routes/ssh-helper.conf

    log "Nginx configurations installed"
}

start_service() {
    log "Starting ssh-helper service..."

    sudo systemctl restart ssh-helper

    # Wait a moment for service to start
    sleep 2

    if systemctl is-active --quiet ssh-helper; then
        log "SSH-helper service started successfully"
    else
        error "Failed to start ssh-helper service. Check logs with: sudo journalctl -u ssh-helper -n 50"
    fi
}

verify_installation() {
    log "Verifying installation..."

    # Check if service is running
    if ! systemctl is-active --quiet ssh-helper; then
        error "ssh-helper service is not running"
    fi

    # Check if app is responding
    if curl -s http://localhost:8080/ > /dev/null; then
        log "SSH-helper is responding on port 8080"
    else
        warn "SSH-helper is not responding on port 8080"
    fi

    log "Verification complete"
}

main() {
    log "Starting ssh-helper bootstrap..."

    check_dependencies
    install_dependencies
    create_config
    install_systemd_service
    install_nginx_configs
    start_service
    verify_installation

    log "SSH-helper bootstrap complete!"
    info ""
    info "Service status: sudo systemctl status ssh-helper"
    info "View logs: sudo journalctl -u ssh-helper -f"
    info "Access at: https://$(hostname -I | awk '{print $1}')/ssh/"
}

main "$@"
