#!/bin/bash

# Verification script for ssh-helper setup

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0

pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((PASSED++))
}

fail() {
    echo -e "${RED}✗${NC} $1"
    ((FAILED++))
}

warn() {
    echo -e "${YELLOW}!${NC} $1"
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "SSH Helper Setup Verification"
echo "=============================="
echo ""

# Check 1: Node.js and npm
echo "Checking Node.js and npm..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    pass "Node.js is installed ($NODE_VERSION)"
else
    fail "Node.js is not installed"
fi

if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    pass "npm is installed ($NPM_VERSION)"
else
    fail "npm is not installed"
fi

# Check 2: Node modules
echo "Checking Node.js dependencies..."
if [ -d "$PROJECT_ROOT/node_modules" ]; then
    pass "node_modules directory exists"

    # Check for key dependencies
    if [ -d "$PROJECT_ROOT/node_modules/express" ]; then
        pass "Express is installed"
    else
        fail "Express is not installed"
    fi

    if [ -d "$PROJECT_ROOT/node_modules/xterm" ] || [ -d "$PROJECT_ROOT/node_modules/@xterm" ]; then
        pass "xterm is installed"
    else
        warn "xterm may not be installed"
    fi
else
    fail "node_modules directory not found (run npm install)"
fi

# Check 3: Configuration file
echo "Checking configuration..."
if [ -f "$PROJECT_ROOT/config.json" ]; then
    pass "config.json exists"

    # Validate JSON
    if jq empty "$PROJECT_ROOT/config.json" 2>/dev/null; then
        pass "config.json is valid JSON"
    else
        fail "config.json is not valid JSON"
    fi
else
    fail "config.json not found"
fi

# Check 4: Server file
echo "Checking server files..."
if [ -f "$PROJECT_ROOT/server.js" ]; then
    pass "server.js exists"
else
    fail "server.js not found"
fi

# Check 5: Systemd service
echo "Checking systemd service..."
if [ -f "/etc/systemd/system/ssh-helper.service" ]; then
    pass "Systemd service file exists"
else
    fail "Systemd service file not found"
fi

if systemctl is-enabled --quiet ssh-helper; then
    pass "ssh-helper service is enabled"
else
    fail "ssh-helper service is not enabled"
fi

if systemctl is-active --quiet ssh-helper; then
    pass "ssh-helper service is running"
else
    fail "ssh-helper service is not running"
fi

# Check 6: Nginx configuration
echo "Checking nginx configuration..."
if [ -f "/etc/nginx/conf.d/system-upstreams/ssh-helper.conf" ]; then
    pass "Nginx upstream config exists"
else
    fail "Nginx upstream config not found"
fi

if [ -f "/etc/nginx/conf.d/routes/ssh-helper.conf" ]; then
    pass "Nginx routes config exists"
else
    fail "Nginx routes config not found"
fi

# Check 7: Service connectivity
echo "Checking service connectivity..."
if curl -s http://localhost:8080/ > /dev/null; then
    pass "SSH-helper responding on port 8080"
else
    fail "SSH-helper not responding on port 8080"
fi

# Check 8: Public directory
echo "Checking public assets..."
if [ -d "$PROJECT_ROOT/public" ]; then
    pass "Public directory exists"
else
    warn "Public directory not found"
fi

# Summary
echo ""
echo "=============================="
echo "Verification Summary"
echo "=============================="
echo -e "${GREEN}Passed:${NC} $PASSED"
if [ $FAILED -gt 0 ]; then
    echo -e "${RED}Failed:${NC} $FAILED"
    echo ""
    echo "Please fix the failed checks before proceeding."
    exit 1
else
    echo -e "${GREEN}All checks passed!${NC}"
    echo ""
    echo "SSH-helper is properly configured."
    echo ""
    echo "Useful commands:"
    echo "  - Check status: sudo systemctl status ssh-helper"
    echo "  - View logs: sudo journalctl -u ssh-helper -f"
    echo "  - Restart: sudo systemctl restart ssh-helper"
    echo "  - Access: https://YOUR_IP/ssh/"
    exit 0
fi
