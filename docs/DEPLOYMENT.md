# SSH Helper - Deployment Guide

Deploy SSH Helper web terminal behind the authentication gateway.

## Overview

SSH Helper provides a browser-based terminal protected by AWS Cognito authentication. Users access it through the authentication gateway which handles all OAuth/Cognito integration.

## Architecture

```
User Browser
     ↓
https://gateway.example.com/ (HTTPS)
     ↓
nginx + oauth2-proxy (Authentication)
     ↓
ssh-helper (port 8080) - Web Terminal
```

## Prerequisites

- Authentication gateway deployed and running
  - See: [easy-cognito-nginx-gateway-auth](https://github.com/YOUR_USERNAME/easy-cognito-nginx-gateway-auth)
- Node.js 16+ installed
- nginx configured with oauth2-proxy

## Installation

### Step 1: Clone Repository

```bash
# On your gateway machine
cd /home/ubuntu/src
git clone https://github.com/YOUR_USERNAME/ssh-helper.git
cd ssh-helper
```

### Step 2: Install Dependencies

```bash
npm install
```

This installs:
- `express` - Web server
- `ws` - WebSocket support for terminal
- `node-pty` - PTY for terminal emulation

### Step 3: Create Systemd Service

```bash
sudo tee /etc/systemd/system/ssh-helper.service > /dev/null << 'EOF'
[Unit]
Description=SSH Helper Web UI
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/src/ssh-helper
ExecStart=/usr/bin/node /home/ubuntu/src/ssh-helper/server.js
Environment=PORT=8080
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### Step 4: Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service (start on boot)
sudo systemctl enable ssh-helper

# Start service
sudo systemctl start ssh-helper

# Check status
sudo systemctl status ssh-helper
```

Expected output:
```
● ssh-helper.service - SSH Helper Web UI
     Loaded: loaded (/etc/systemd/system/ssh-helper.service; enabled)
     Active: active (running)
   Main PID: 12345
```

### Step 5: Configure nginx

Edit your gateway nginx configuration:

```bash
sudo nano /etc/nginx/sites-available/auth-gateway
```

#### Option A: Root Path (Default)

SSH Helper at `https://gateway.example.com/`

```nginx
# Add upstream
upstream ssh_helper {
    server 127.0.0.1:8080;
}

# Inside server block
server {
    # ... SSL config ...

    # OAuth2 proxy location (required)
    location /oauth2/ {
        proxy_pass http://127.0.0.1:4180;
        # ... oauth2-proxy config ...
    }

    # SSH Helper at root (protected)
    location / {
        # Authentication check
        auth_request /oauth2/auth;
        error_page 401 = /oauth2/start?rd=$scheme://$host$request_uri;

        # Extract user info from oauth2-proxy
        auth_request_set $user $upstream_http_x_auth_request_user;
        auth_request_set $email $upstream_http_x_auth_request_email;

        # Pass to ssh-helper
        proxy_pass http://ssh_helper;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Pass authenticated user info
        proxy_set_header X-User-Email $email;
        proxy_set_header X-Auth-Request-User $user;

        # WebSocket support (required for terminal)
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }
}
```

#### Option B: Subdirectory Path

SSH Helper at `https://gateway.example.com/ssh/`

```nginx
# Add upstream
upstream ssh_helper {
    server 127.0.0.1:8080;
}

# Inside server block
location /ssh/ {
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/start?rd=$scheme://$host$request_uri;

    auth_request_set $user $upstream_http_x_auth_request_user;
    auth_request_set $email $upstream_http_x_auth_request_email;

    proxy_set_header X-User-Email $email;
    proxy_set_header X-Auth-Request-User $user;

    # Strip /ssh/ prefix
    rewrite ^/ssh/(.*)$ /$1 break;
    proxy_pass http://ssh_helper;

    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # WebSocket support
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### Step 6: Test and Reload nginx

```bash
# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx
```

## Access

### Root Path Setup
```
https://52.43.35.1/
```

### Subdirectory Setup
```
https://52.43.35.1/ssh/
```

You'll be:
1. Redirected to Cognito login
2. Authenticate with your Cognito credentials
3. Redirected back to the terminal interface
4. See a web-based terminal in your browser

## Service Management

### Check Status

```bash
sudo systemctl status ssh-helper
```

### View Logs

```bash
# Real-time logs
sudo journalctl -u ssh-helper -f

# Last 50 lines
sudo journalctl -u ssh-helper -n 50

# Logs since today
sudo journalctl -u ssh-helper --since today
```

### Restart Service

```bash
sudo systemctl restart ssh-helper
```

### Stop Service

```bash
sudo systemctl stop ssh-helper
```

### Disable Service (prevent auto-start)

```bash
sudo systemctl disable ssh-helper
```

## Configuration

### Port Configuration

Default port: 8080

To change:

```bash
# Edit service file
sudo nano /etc/systemd/system/ssh-helper.service

# Change Environment line:
Environment=PORT=8090

# Reload and restart
sudo systemctl daemon-reload
sudo systemctl restart ssh-helper
```

### IP Whitelist

Edit `config.json`:

```json
{
  "allowAll": false,
  "ipWhitelist": ["203.0.113.5", "198.51.100.10"],
  "shell": "/bin/bash",
  "terminalCols": 120,
  "terminalRows": 30
}
```

```bash
# Restart to apply
sudo systemctl restart ssh-helper
```

## Troubleshooting

### Issue: Service won't start

**Check logs:**
```bash
sudo journalctl -u ssh-helper -n 50
```

**Common causes:**

1. **Port already in use:**
   ```bash
   sudo lsof -i :8080
   # Kill conflicting process
   sudo kill <PID>
   ```

2. **Missing dependencies:**
   ```bash
   cd /home/ubuntu/src/ssh-helper
   npm install
   sudo systemctl restart ssh-helper
   ```

3. **Permission issues:**
   ```bash
   sudo chown -R ubuntu:ubuntu /home/ubuntu/src/ssh-helper
   ```

### Issue: Can't access terminal in browser

**Check nginx logs:**
```bash
sudo tail -f /var/log/nginx/error.log
```

**Check if service is running:**
```bash
sudo systemctl status ssh-helper
curl http://localhost:8080/
```

**Check authentication:**
```bash
# Check oauth2-proxy
sudo systemctl status oauth2-proxy

# Check oauth2-proxy logs
sudo journalctl -u oauth2-proxy -n 50
```

### Issue: Terminal not connecting

**Verify WebSocket support:**

nginx must have WebSocket headers:
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

**Check browser console:**
- Open browser DevTools (F12)
- Look for WebSocket connection errors
- Check for blocked requests

### Issue: Authentication loop

**Check Cognito callback URL:**

In AWS Cognito console:
- App client settings
- Callback URL must match: `https://your-domain.com/oauth2/callback`

**Check oauth2-proxy config:**
```bash
sudo cat /etc/oauth2-proxy/config.cfg
```

Verify:
- `redirect_url` matches Cognito callback URL
- `client_id` and `client_secret` are correct

## Security Considerations

### 1. Terminal Access

The terminal runs as the `ubuntu` user. Users can execute any command this user has permission for.

**To restrict commands:**
- Use a restricted shell
- Modify `config.json` to use `/bin/rbash`
- Set up sudo restrictions

### 2. Session Timeout

Configure oauth2-proxy session timeout:

```bash
# Edit oauth2-proxy config
sudo nano /etc/oauth2-proxy/config.cfg

# Add/modify
cookie_refresh = "1h"
cookie_expire = "24h"
```

### 3. IP Restrictions

Restrict terminal access by IP:

```json
{
  "allowAll": false,
  "ipWhitelist": ["203.0.113.0/24"]
}
```

### 4. Audit Logging

All terminal commands are logged to systemd:

```bash
# View command history
sudo journalctl -u ssh-helper | grep "Command executed"
```

## Performance Tuning

### For High Traffic

Increase nginx worker connections:

```bash
sudo nano /etc/nginx/nginx.conf
```

```nginx
events {
    worker_connections 2048;
}
```

### For Many Concurrent Terminals

Increase file descriptor limits:

```bash
sudo nano /etc/systemd/system/ssh-helper.service
```

Add:
```ini
[Service]
LimitNOFILE=65536
```

## Backup and Recovery

### Backup Configuration

```bash
# Backup systemd service
sudo cp /etc/systemd/system/ssh-helper.service ~/ssh-helper.service.backup

# Backup application
tar -czf ssh-helper-backup.tar.gz /home/ubuntu/src/ssh-helper
```

### Recovery

```bash
# Restore service file
sudo cp ~/ssh-helper.service.backup /etc/systemd/system/ssh-helper.service
sudo systemctl daemon-reload

# Restore application
tar -xzf ssh-helper-backup.tar.gz -C /home/ubuntu/src/

# Restart
sudo systemctl restart ssh-helper
```

## Monitoring

### Check Service Health

```bash
# Service status
systemctl is-active ssh-helper

# Process check
pgrep -f "node.*ssh-helper"

# Port check
netstat -tlnp | grep 8080
```

### Set Up Monitoring Alerts

Example CloudWatch monitoring:

```bash
# Install CloudWatch agent
wget https://s3.amazonaws.com/amazoncloudwatch-agent/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
sudo dpkg -i amazon-cloudwatch-agent.deb

# Configure to monitor ssh-helper service
# See AWS CloudWatch documentation
```

## Upgrading

### Update to Latest Version

```bash
cd /home/ubuntu/src/ssh-helper

# Pull latest changes
git pull origin main

# Install any new dependencies
npm install

# Restart service
sudo systemctl restart ssh-helper
```

### Zero-Downtime Upgrade

```bash
# Start new version on different port
PORT=8081 node server.js &

# Test new version
curl http://localhost:8081/

# Update nginx to point to new port
sudo nano /etc/nginx/sites-available/auth-gateway
# Change upstream port to 8081

sudo nginx -t
sudo systemctl reload nginx

# Stop old service
sudo systemctl stop ssh-helper

# Update service to use main version
sudo systemctl start ssh-helper
```

## Related Documentation

- [SSH Helper README](../README.md)
- [Authentication Gateway](https://github.com/YOUR_USERNAME/easy-cognito-nginx-gateway-auth)
- [Website Cloner](https://github.com/YOUR_USERNAME/website-cloner)
- [Integration Guide](https://github.com/YOUR_USERNAME/easy-cognito-nginx-gateway-auth/blob/main/docs/INTEGRATION.md)
