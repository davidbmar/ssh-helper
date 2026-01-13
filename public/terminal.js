/**
 * Terminal.js - WebSocket Terminal Client
 *
 * Connects to the backend WebSocket server and handles terminal I/O
 */

(function() {
    'use strict';

    // Initialize Xterm.js terminal
    const term = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme: {
            background: '#1e1e1e',
            foreground: '#d4d4d4',
            cursor: '#ffffff',
            black: '#000000',
            red: '#cd3131',
            green: '#0dbc79',
            yellow: '#e5e510',
            blue: '#2472c8',
            magenta: '#bc3fbc',
            cyan: '#11a8cd',
            white: '#e5e5e5',
            brightBlack: '#666666',
            brightRed: '#f14c4c',
            brightGreen: '#23d18b',
            brightYellow: '#f5f543',
            brightBlue: '#3b8eea',
            brightMagenta: '#d670d6',
            brightCyan: '#29b8db',
            brightWhite: '#ffffff'
        }
    });

    // Add fit addon for responsive terminal
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    // Add web links addon
    const webLinksAddon = new WebLinksAddon.WebLinksAddon();
    term.loadAddon(webLinksAddon);

    // Open terminal in DOM
    const terminalElement = document.getElementById('terminal');
    term.open(terminalElement);

    // Fit terminal to container
    fitAddon.fit();

    // WebSocket connection
    let ws = null;
    let reconnectInterval = null;

    function updateStatus(status, connected) {
        const statusElement = document.getElementById('status');
        const connectionStatus = document.getElementById('connection-status');

        if (connected) {
            statusElement.style.color = '#0dbc79';
            connectionStatus.textContent = status;
            connectionStatus.style.color = '#0dbc79';
        } else {
            statusElement.style.color = '#cd3131';
            connectionStatus.textContent = status;
            connectionStatus.style.color = '#cd3131';
        }
    }

    function connect() {
        // Determine WebSocket URL (use wss:// if page is https://)
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        // Include the current path so WebSocket connects to the same endpoint
        const wsUrl = `${protocol}//${window.location.host}${window.location.pathname}`;

        console.log('[Terminal] Connecting to:', wsUrl);
        updateStatus('Connecting...', false);

        ws = new WebSocket(wsUrl);

        ws.onopen = function() {
            console.log('[Terminal] WebSocket connected');
            updateStatus('Connected', true);

            // Clear reconnect interval if it exists
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }

            // Send terminal size
            ws.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
            }));
        };

        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);

                switch (data.type) {
                    case 'output':
                        term.write(data.data);
                        break;

                    case 'welcome':
                        term.write('\r\n\x1b[1;32m' + data.message + '\x1b[0m\r\n');
                        break;

                    case 'exit':
                        term.write('\r\n\x1b[1;31mTerminal session ended.\x1b[0m\r\n');
                        updateStatus('Disconnected', false);
                        break;

                    default:
                        console.log('[Terminal] Unknown message type:', data.type);
                }
            } catch (error) {
                console.error('[Terminal] Error processing message:', error);
            }
        };

        ws.onerror = function(error) {
            console.error('[Terminal] WebSocket error:', error);
            updateStatus('Error', false);
        };

        ws.onclose = function() {
            console.log('[Terminal] WebSocket closed');
            updateStatus('Disconnected', false);

            // Attempt to reconnect after 3 seconds
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('[Terminal] Attempting to reconnect...');
                    connect();
                }, 3000);
            }
        };

        // Handle terminal input
        term.onData(function(data) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'input',
                    data: data
                }));
            }
        });

        // Handle terminal resize
        term.onResize(function(size) {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({
                    type: 'resize',
                    cols: size.cols,
                    rows: size.rows
                }));
            }
        });
    }

    // Fetch user info
    fetch('./api/user')
        .then(response => response.json())
        .then(data => {
            document.getElementById('user-email').textContent = data.email || 'Anonymous';
        })
        .catch(error => {
            console.error('[Terminal] Error fetching user info:', error);
            document.getElementById('user-email').textContent = 'Unknown User';
        });

    // Handle window resize
    let resizeTimeout;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            fitAddon.fit();
        }, 100);
    });

    // Handle page unload
    window.addEventListener('beforeunload', function() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }
    });

    // Focus terminal on page load
    setTimeout(() => {
        term.focus();
    }, 100);

    // Connect to WebSocket
    connect();

})();
