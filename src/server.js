const http = require('http');
const WebSocket = require('ws');
const { getConfig } = require('./config/env');
const { routeMessage } = require('./core/messageRouter');
const { leaveRoom } = require('./core/roomManager');
const { logInfo, logError } = require('./utils/logger');

const config = getConfig();

const server = http.createServer((req, res) => {
    if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ status: 'ok' }));
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

server.listen(config.PORT, () => {
    logInfo(`Server listening on port ${config.PORT}`);
});

module.exports = { server, wss };
