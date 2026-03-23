const { isValidCode } = require('../utils/validateCode');
const { sendSecure } = require('../crypto/boxChannel');
const { getSessionForClientInRoom, broadcastToRoom, wakeSessionByCode } = require('../core/roomManager');
const { logInfo } = require('../utils/logger');

/**
 * Kategorija 1 — "pingaj mene": server potvrđuje da si u sobi i koliko ima peerova.
 * Unutar box kanala, nakon joina.
 */
function handlePingSelf(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const session = getSessionForClientInRoom(ws, code);
    if (!session) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'not_in_room',
            message: 'You are not in this room',
        });
    }

    wakeSessionByCode(code);

    const peersInRoom = session.clients.size;
    let roomState;
    if (session.type === 'direct') {
        roomState = peersInRoom === 1 ? 'waiting_peer' : 'connected';
    } else {
        roomState = 'active';
    }

    logInfo(`[ping_self] pin=${code} | peers=${peersInRoom} | roomState=${roomState}`);

    sendSecure(ws, {
        t: 'ping_self_ack',
        category: 'ping_self',
        code,
        roomType: session.type,
        roomState,
        peersInRoom,
    });
}

/**
 * Kategorija 2 — ping prema drugom klijentu (B): relay kroz server.
 * Šalje samo ako u sobi postoji barem jedan drugi peer.
 */
function handlePeerPing(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const session = getSessionForClientInRoom(ws, code);
    if (!session) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'not_in_room',
            message: 'You are not in this room',
        });
    }

    if (session.clients.size < 2) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'peer_not_ready',
            message: 'No other peer in room to ping',
            category: 'ping_peer',
        });
    }

    wakeSessionByCode(code);

    logInfo(`[peer_ping] relay | pin=${code}`);

    broadcastToRoom(code, ws, {
        t: 'peer_ping',
        category: 'ping_peer',
        code,
        nonce: typeof msg.nonce === 'string' ? msg.nonce : undefined,
        ts: typeof msg.ts === 'number' ? msg.ts : undefined,
    });
}

function handlePeerPong(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const session = getSessionForClientInRoom(ws, code);
    if (!session) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'not_in_room',
            message: 'You are not in this room',
        });
    }

    if (session.clients.size < 2) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'peer_not_ready',
            message: 'No other peer in room',
            category: 'ping_peer',
        });
    }

    wakeSessionByCode(code);

    logInfo(`[peer_pong] relay | pin=${code}`);

    broadcastToRoom(code, ws, {
        t: 'peer_pong',
        category: 'ping_peer',
        code,
        nonce: typeof msg.nonce === 'string' ? msg.nonce : undefined,
        ts: typeof msg.ts === 'number' ? msg.ts : undefined,
    });
}

module.exports = {
    handlePingSelf,
    handlePeerPing,
    handlePeerPong,
};
