const http = require('http');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');
const { getConfig } = require('./config/env');
const { initServerIdentity } = require('./crypto/serverIdentity');
const { initSessionDb, listAllSessionsFromDb } = require('./db/sessionStore');
const { routeMessage } = require('./core/messageRouter');
const { leaveRoom, listActiveRooms } = require('./core/roomManager');
const { logInfo, logError } = require('./utils/logger');

const config = getConfig();

const indexHtmlPath = path.join(__dirname, '..', 'public', 'index.html');
let indexHtml;
try {
    indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');
} catch (err) {
    logError('Could not read public/index.html', err);
    indexHtml = null;
}

const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;

    if (req.method === 'GET' && pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
    }

    if (req.method === 'GET' && pathname === '/api/rooms') {
        try {
            const payload = {
                rooms: listActiveRooms(),
                database: listAllSessionsFromDb(),
            };
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            return res.end(JSON.stringify(payload));
        } catch (err) {
            logError('GET /api/rooms failed', err);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            return res.end(JSON.stringify({ error: 'internal_error' }));
        }
    }

    if (req.method === 'GET' && pathname === '/') {
        if (indexHtml) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(indexHtml);
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Index not available');
    }

    res.writeHead(404);
    res.end();
});

const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
    logInfo('New client connected');

    ws.on('message', (data) => {
        routeMessage(ws, data.toString());
    });

    ws.on('close', () => {
        leaveRoom(ws);
        logInfo('Client disconnected');
    });

    ws.on('error', (err) => {
        logError('WS error', err);
    });
});

const listeningPromise = (async () => {
    await sodium.ready;
    await initServerIdentity();
    initSessionDb();
    await new Promise((resolve, reject) => {
        server.listen(config.PORT, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    logInfo(`Server listening on port ${config.PORT}`);
})().catch((err) => {
    logError('Server failed to start', err);
    process.exit(1);
});

module.exports = { server, wss, listeningPromise };
