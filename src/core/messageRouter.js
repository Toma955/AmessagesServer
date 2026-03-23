const { handlePing } = require('../handlers/pingHandler');
const { handleGetServerKey } = require('../handlers/serverKeyHandler');
const { handleClientKey } = require('../handlers/clientKeyHandler');
const { handleJoin } = require('../handlers/joinHandler');
const { handleSignal } = require('../handlers/signalHandler');
const { handleMessage } = require('../handlers/messageHandler');
const { handleExtendResponse } = require('../handlers/extendHandler');
const { hasClientKey } = require('./clientKeys');
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

    if (msg.t === 'ping') {
        return handlePing(ws, msg);
    }

    if (msg.t === 'get_server_key') {
        return handleGetServerKey(ws);
    }

    if (msg.t === 'client_key') {
        return handleClientKey(ws, msg);
    }

    if (!hasClientKey(ws)) {
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'key_exchange_required',
            message: 'Send get_server_key then client_key first',
        }));
    }

    switch (msg.t) {
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
