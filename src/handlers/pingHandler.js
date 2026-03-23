const { logInfo } = require('../utils/logger');

function handlePing(ws, _msg) {
    logInfo(`[WS] plaintext | ping → pong | id=ws${ws._clientId ?? '?'}`);
    ws.send(JSON.stringify({ t: 'pong', alive: true }));
}

module.exports = { handlePing };
