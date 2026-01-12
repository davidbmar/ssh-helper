#!/usr/bin/env node

/**
 * SSH Helper - Web-based Terminal
 *
 * Provides browser-based terminal access with IP whitelisting.
 * Authentication is handled by nginx + oauth2-proxy (Cognito).
 * This app simply trusts the X-User-Email header from nginx.
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const pty = require('node-pty');
const path = require('path');
const fs = require('fs');

// Configuration
const PORT = process.env.PORT || 8080;
const CONFIG_PATH = process.env.CONFIG_PATH || path.join(__dirname, 'config.json');

// Load configuration
let config = {
  ipWhitelist: [],
  allowAll: false,
  shell: process.env.SHELL || '/bin/bash',
  terminalCols: 80,
  terminalRows: 24
};

try {
  if (fs.existsSync(CONFIG_PATH)) {
    const configData = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = { ...config, ...JSON.parse(configData) };
    console.log('[CONFIG] Loaded configuration from', CONFIG_PATH);
  } else {
    console.log('[CONFIG] No config file found, using defaults');
  }
} catch (error) {
  console.error('[CONFIG] Error loading config:', error.message);
  console.log('[CONFIG] Using default configuration');
}

// Express app
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// IP Whitelist Middleware
function ipWhitelistMiddleware(req, res, next) {
  // If allowAll is true, skip whitelist check
  if (config.allowAll) {
    return next();
  }

  // Get client IP (handle proxy headers)
  const clientIp = req.headers['x-real-ip'] ||
                   req.headers['x-forwarded-for']?.split(',')[0] ||
                   req.socket.remoteAddress;

  console.log('[IP-CHECK] Client IP:', clientIp);

  // Check if IP is whitelisted
  if (config.ipWhitelist.length === 0) {
    console.log('[IP-CHECK] No whitelist configured, allowing all IPs');
    return next();
  }

  const isWhitelisted = config.ipWhitelist.some(ip => {
    // Support CIDR notation or simple IP match
    if (ip.includes('/')) {
      // Simple CIDR check (could use a library for production)
      const [network, bits] = ip.split('/');
      return clientIp.startsWith(network.split('.').slice(0, Math.floor(bits / 8)).join('.'));
    }
    return clientIp === ip || clientIp.endsWith(ip);
  });

  if (!isWhitelisted) {
    console.log('[IP-CHECK] IP not whitelisted:', clientIp);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Your IP address is not whitelisted'
    });
  }

  console.log('[IP-CHECK] IP whitelisted:', clientIp);
  next();
}

// Apply IP whitelist to all routes
app.use(ipWhitelistMiddleware);

// Serve static files (terminal UI)
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'ssh-helper' });
});

// Get user info (passed from nginx)
app.get('/api/user', (req, res) => {
  const userEmail = req.headers['x-user-email'] || 'anonymous';
  const userName = req.headers['x-auth-request-user'] || 'anonymous';

  res.json({
    email: userEmail,
    name: userName
  });
});

// WebSocket terminal sessions
const terminals = new Map();
let terminalId = 0;

wss.on('connection', (ws, req) => {
  // Get user info from headers
  const userEmail = req.headers['x-user-email'] || 'anonymous';
  const userName = req.headers['x-auth-request-user'] || 'anonymous';
  const clientIp = req.headers['x-real-ip'] || req.socket.remoteAddress;

  console.log('[TERMINAL] New connection from:', userEmail, 'IP:', clientIp);

  // Spawn PTY
  const id = terminalId++;
  const term = pty.spawn(config.shell, [], {
    name: 'xterm-256color',
    cols: config.terminalCols,
    rows: config.terminalRows,
    cwd: process.env.HOME || '/home/ubuntu',
    env: {
      ...process.env,
      USER_EMAIL: userEmail,
      USER_NAME: userName
    }
  });

  terminals.set(id, term);

  console.log(`[TERMINAL] Created terminal ${id} for user ${userEmail}`);

  // Send terminal output to WebSocket
  term.on('data', (data) => {
    try {
      ws.send(JSON.stringify({ type: 'output', data }));
    } catch (error) {
      console.error('[TERMINAL] Error sending data:', error.message);
    }
  });

  term.on('exit', (code) => {
    console.log(`[TERMINAL] Terminal ${id} exited with code ${code}`);
    terminals.delete(id);
    try {
      ws.send(JSON.stringify({ type: 'exit', code }));
      ws.close();
    } catch (error) {
      // WebSocket might already be closed
    }
  });

  // Handle WebSocket messages (user input)
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
        case 'input':
          if (term) {
            term.write(data.data);
          }
          break;

        case 'resize':
          if (term && data.cols && data.rows) {
            term.resize(data.cols, data.rows);
            console.log(`[TERMINAL] Resized ${id} to ${data.cols}x${data.rows}`);
          }
          break;

        default:
          console.log('[TERMINAL] Unknown message type:', data.type);
      }
    } catch (error) {
      console.error('[TERMINAL] Error processing message:', error.message);
    }
  });

  // Handle WebSocket close
  ws.on('close', () => {
    console.log(`[TERMINAL] WebSocket closed for terminal ${id}`);
    if (term) {
      term.kill();
      terminals.delete(id);
    }
  });

  ws.on('error', (error) => {
    console.error(`[TERMINAL] WebSocket error for terminal ${id}:`, error.message);
  });

  // Send welcome message
  setTimeout(() => {
    try {
      ws.send(JSON.stringify({
        type: 'welcome',
        message: `Connected as ${userEmail}\n`
      }));
    } catch (error) {
      // Ignore if WebSocket is not ready
    }
  }, 100);
});

// Start server
server.listen(PORT, () => {
  console.log('═══════════════════════════════════════════════════════');
  console.log('  SSH Helper - Web Terminal');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`  Server running on port ${PORT}`);
  console.log(`  IP Whitelist: ${config.allowAll ? 'DISABLED (all IPs allowed)' : 'ENABLED'}`);
  if (!config.allowAll && config.ipWhitelist.length > 0) {
    console.log(`  Whitelisted IPs: ${config.ipWhitelist.join(', ')}`);
  }
  console.log(`  Shell: ${config.shell}`);
  console.log('═══════════════════════════════════════════════════════');
  console.log('  Access via nginx proxy at https://52.43.35.1/');
  console.log('  (Authentication handled by nginx + Cognito)');
  console.log('═══════════════════════════════════════════════════════');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] Received SIGTERM, closing terminals...');
  terminals.forEach((term, id) => {
    console.log(`[SHUTDOWN] Killing terminal ${id}`);
    term.kill();
  });
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] Received SIGINT, closing terminals...');
  terminals.forEach((term, id) => {
    console.log(`[SHUTDOWN] Killing terminal ${id}`);
    term.kill();
  });
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});
