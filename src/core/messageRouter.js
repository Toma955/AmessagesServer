const { handlePing } = require('../handlers/pingHandler');
const { handleJoin } = require('../handlers/joinHandler');
const { handleSignal } = require('../handlers/signalHandler');
const { handleMessage } = require('../handlers/messageHandler');
const { handleExtendResponse } = require('../handlers/extendHandler');
const { logError } = require('../utils/logger');

function routeMessage(ws, raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch (e) {
        logError('Invalid JSON message');
        return;
    }

    // healthcheck posebni kod
    if (msg.code === '1111111111111111') {
        return handlePing(ws, msg);
    }

    switch (msg.t) {
        case 'ping':
            return handlePing(ws, msg);

        case 'join':
            return handleJoin(ws, msg);

        case 'signal':
            return handleSignal(ws, msg);

        case 'msg':
            return handleMessage(ws, msg);

        case 'extend_response':
            return handleExtendResponse(ws, msg);

        default:
            ws.send(JSON.stringify({ t: 'error', reason: 'unknown_type' }));
    }
}

module.exports = { routeMessage };
