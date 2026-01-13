# SSH Helper - Web-Based Terminal

A lightweight web-based SSH terminal with IP whitelisting support. Provides secure browser-based access to a shell terminal.

## Features

- 🖥️ **Full Terminal Emulation**: Complete xterm.js terminal with color support
- 🔒 **IP Whitelisting**: Optional IP-based access control
- 🔐 **Authentication Gateway**: Works seamlessly with nginx + Cognito auth
- 📱 **Responsive Design**: Works on desktop and mobile browsers
- ⚡ **WebSocket Connection**: Real-time terminal I/O
- 🎨 **Modern UI**: Clean, professional interface

## Deployment Status

✅ **Currently Deployed and Running**

- **Gateway**: https://52.43.35.1/
- **Service**: Active on port 8080
- **Systemd**: Enabled and running
- **Authentication**: Protected by AWS Cognito via oauth2-proxy

Access the terminal at: **https://52.43.35.1/**

## Architecture

```
User → Nginx (HTTPS) → OAuth2 Proxy (Cognito) → SSH Helper (port 8080)
                                                      ↓
                                                  PTY (bash)
```

**Authentication Flow:**
1. User accesses https://52.43.35.1/
2. Nginx requires authentication via oauth2-proxy
3. OAuth2-proxy redirects to Cognito for login
4. After successful auth, nginx proxies to ssh-helper on port 8080
5. SSH helper receives authenticated user info via headers
6. Terminal session spawned for the authenticated user

**Key Design Decision:** Authentication is handled entirely by nginx + oauth2-proxy. The ssh-helper application trusts the `X-User-Email` and `X-Auth-Request-User` headers passed from nginx, simplifying the application code and centralizing auth logic.

## Prerequisites

- Node.js 16+
- npm or yarn
- Linux environment (uses PTY)

## Installation

```bash
# Clone repository
cd /home/ubuntu/src/ssh-helper

# Install dependencies
npm install

# Configure (optional)
cp config.json config.local.json
# Edit config.local.json as needed
```

## Configuration

Edit `config.json` to customize behavior:

```json
{
  "allowAll": true,              // Allow all IPs (set false to enable whitelist)
  "ipWhitelist": [               // IPs to allow (when allowAll=false)
    "192.168.1.0/24",
    "10.0.0.100"
  ],
  "shell": "/bin/bash",          // Shell to spawn
  "terminalCols": 120,           // Default terminal columns
  "terminalRows": 30             // Default terminal rows
}
```

### IP Whitelist Options

**Allow All (Recommended):**
```json
{
  "allowAll": true,
  "ipWhitelist": []
}
```

Since nginx already handles authentication via Cognito, IP whitelisting is typically unnecessary. Use `allowAll: true` for simplicity.

**Whitelist Specific IPs:**
```json
{
  "allowAll": false,
  "ipWhitelist": [
    "192.168.1.100",              // Single IP
    "10.0.0.0/24",                // CIDR notation (all IPs in 10.0.0.x)
    "172.16.0.0/16"               // Larger CIDR block
  ]
}
```

## Running the Application

### Development Mode

```bash
npm run dev
```

Uses nodemon for auto-restart on file changes.

### Production Mode

```bash
npm start
```

### Systemd Service (Recommended)

Create `/etc/systemd/system/ssh-helper.service`:

```ini
[Unit]
Description=SSH Helper - Web Terminal
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/src/ssh-helper
ExecStart=/usr/bin/node /home/ubuntu/src/ssh-helper/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ssh-helper

# Environment
Environment=NODE_ENV=production
Environment=PORT=8080

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl daemon-reload
sudo systemctl enable ssh-helper
sudo systemctl start ssh-helper
sudo systemctl status ssh-helper
```

View logs:

```bash
# Real-time logs
sudo journalctl -u ssh-helper -f

# Recent logs
sudo journalctl -u ssh-helper -n 100
```

## Nginx Configuration

This application uses a **modular nginx configuration architecture** where each app manages its own routing configuration. The ssh-helper repo contains two nginx files that are deployed to the gateway server.

### Configuration Files in this Repo

**nginx/upstream.conf** - Upstream definition:
```nginx
upstream ssh_terminal {
    server 127.0.0.1:8080;
}
```

**nginx/routes.conf** - Location block for /ssh endpoint:
```nginx
location /ssh {
    # Authentication check via oauth2-proxy
    auth_request /oauth2/auth;
    error_page 401 = /oauth2/start?rd=$scheme://$host$request_uri;

    # Pass authentication headers from oauth2-proxy to backend
    auth_request_set $user $upstream_http_x_auth_request_user;
    auth_request_set $email $upstream_http_x_auth_request_email;
    auth_request_set $auth_cookie $upstream_http_set_cookie;
    add_header Set-Cookie $auth_cookie;

    # Proxy to ssh terminal application (port 8080)
    proxy_pass http://ssh_terminal;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Pass authenticated user info to backend
    proxy_set_header X-User-Email $email;
    proxy_set_header X-Auth-Request-User $user;

    # WebSocket support for terminal sessions
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400;
}
```

### Deployment to Gateway Server

When deploying or updating the nginx configuration, copy these files to the gateway:

```bash
# Copy upstream configuration
sudo cp /home/ubuntu/src/ssh-helper/nginx/upstream.conf \
        /etc/nginx/conf.d/system-upstreams/ssh-helper.conf

# Copy routes configuration
sudo cp /home/ubuntu/src/ssh-helper/nginx/routes.conf \
        /etc/nginx/conf.d/routes/ssh-helper.conf

# Test and reload nginx
sudo nginx -t && sudo systemctl reload nginx
```

### Architecture Benefits

- **Separation of Concerns**: ssh-helper owns its routing configuration
- **Version Control**: nginx configs are versioned with application code
- **Easy Updates**: Modify routes without touching the central gateway config
- **No Conflicts**: Each app manages its own namespace (/ssh, /cloner, etc.)

### Routes Managed by this App

- `/ssh` - SSH terminal web interface (port 8080)

## API Endpoints

### GET /
Returns the terminal UI (HTML page).

### GET /api/user
Returns authenticated user information.

**Response:**
```json
{
  "email": "user@example.com",
  "name": "username"
}
```

### GET /health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "ssh-helper"
}
```

### WebSocket /
WebSocket connection for terminal I/O.

**Client → Server Messages:**
```json
// Send user input
{ "type": "input", "data": "ls\n" }

// Resize terminal
{ "type": "resize", "cols": 120, "rows": 30 }
```

**Server → Client Messages:**
```json
// Terminal output
{ "type": "output", "data": "file1.txt\nfile2.txt\n" }

// Welcome message
{ "type": "welcome", "message": "Connected as user@example.com\n" }

// Session ended
{ "type": "exit", "code": 0 }
```

## Security Considerations

1. **Authentication:** Handled by nginx + oauth2-proxy (Cognito). Application trusts nginx headers.
2. **IP Whitelist:** Optional additional layer. Not required when using Cognito auth.
3. **User Isolation:** Each terminal session runs as the server's user (ubuntu). Consider containerization for multi-tenant scenarios.
4. **HTTPS:** Always use HTTPS in production (handled by nginx).
5. **Command Injection:** Terminal input is passed directly to PTY. Only grant access to trusted users.

## File Structure

```
ssh-helper/
├── server.js              # Main application server
├── package.json           # Dependencies and scripts
├── config.json            # Configuration file
├── .gitignore            # Git ignore rules
├── README.md             # This file
└── public/               # Static files (served at /)
    ├── index.html        # Terminal UI page
    ├── terminal.js       # WebSocket client logic
    └── styles.css        # UI styling
```

## Troubleshooting

### Terminal not connecting

Check that:
1. Server is running on port 8080: `netstat -tlnp | grep 8080`
2. WebSocket connection succeeds (check browser console)
3. Nginx is proxying correctly: `sudo nginx -t && sudo systemctl status nginx`

### IP blocked

If you see "Access denied" or 403 errors:
1. Check server logs: `journalctl -u ssh-helper -n 50`
2. Verify your IP is whitelisted in `config.json`
3. Or set `"allowAll": true` to disable IP filtering

### Authentication loop

If redirected to Cognito repeatedly:
1. Check oauth2-proxy is running: `systemctl status oauth2-proxy`
2. Verify nginx auth_request configuration
3. Clear browser cookies and try again

### Terminal crashes

Check logs for errors:
```bash
sudo journalctl -u ssh-helper -f
```

Common issues:
- PTY spawn failure (check shell path in config)
- Permission issues (ensure user has shell access)
- Out of memory (monitor with `htop`)

## Development

### Adding Features

The application has three main components:

1. **server.js** - Backend (Express + WebSocket + PTY)
2. **public/index.html** - UI structure
3. **public/terminal.js** - Frontend logic (xterm.js + WebSocket)

### Useful npm Scripts

```bash
npm start          # Production mode
npm run dev        # Development with auto-reload
```

### Environment Variables

- `PORT` - Server port (default: 8080)
- `CONFIG_PATH` - Path to config file (default: ./config.json)
- `NODE_ENV` - Environment (development/production)

## Deployment Checklist

- [x] Dependencies installed: `npm install`
- [x] Config file created and reviewed
- [x] Systemd service file created at `/etc/systemd/system/ssh-helper.service`
- [x] Service enabled: `sudo systemctl enable ssh-helper`
- [x] Service started: `sudo systemctl start ssh-helper` (PID: 145850)
- [x] Nginx configured at `/etc/nginx/sites-available/auth-gateway`
- [x] Nginx reloaded: `sudo systemctl reload nginx`
- [x] OAuth2-proxy running (port 4180)
- [x] HTTPS certificate valid (self-signed for development)
- [x] Port 8080 accessible from localhost only
- [x] Logs verified: Service running successfully

**Deployment Date:** 2026-01-12
**Deployed By:** Claude Sonnet 4.5

### Quick Status Check

```bash
# Check service status
sudo systemctl status ssh-helper

# View logs
sudo journalctl -u ssh-helper -n 20

# Test local access
curl http://localhost:8080/

# Test authenticated access
curl -k https://52.43.35.1/
```

## License

MIT

## Related Projects

- **easy-cognito-nginx-gateway-auth** - Handles Cognito authentication for this app
- **website-cloner** - Another app behind the same auth gateway
