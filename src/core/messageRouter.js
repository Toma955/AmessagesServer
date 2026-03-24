const { handlePing } = require('../handlers/pingHandler');
const { handleGetServerKey } = require('../handlers/serverKeyHandler');
const { handleClientKey } = require('../handlers/clientKeyHandler');
const { handleJoin } = require('../handlers/joinHandler');
const { handleSignal } = require('../handlers/signalHandler');
const { handleMessage } = require('../handlers/messageHandler');
const { handleCloseSession } = require('../handlers/closeSessionHandler');
const { handlePingSelf, handlePeerPing, handlePeerPong } = require('../handlers/securityPingHandler');
const { handleE2eReady } = require('../handlers/e2eHandler');
const { handleInsideConfirm, handleInsideHybrid } = require('../handlers/insideConfirmHandler');
const { hasClientKey } = require('./clientKeys');
const { decryptFromClient, trySendSecure } = require('../crypto/boxChannel');
const { logError, logInfo } = require('../utils/logger');

function routeMessage(ws, raw) {
    let msg;
    try {
        msg = JSON.parse(raw);
    } catch (e) {
        logError('Invalid JSON message', raw.slice(0, 200));
        return;
    }

    // Samo plaintext { "t": "ping" } — ne smijemo hvatati root "code" jer klijenti mogu slati
    // { "t": "box", "code": "<PIN>", ... } s PIN-om 1111111111111111 (sudar sa starim healthcheckom).

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
        logInfo(`[WS] reply plaintext error | reason=key_exchange_required | msg.t=${msg.t}`);
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'key_exchange_required',
            message: 'Send get_server_key then client_key first',
        }));
    }

    // Nakon razmjene ključeva: samo box (enkriptirani kanal). Iznimka: gore navedeni plaintext tipovi.
    if (msg.t !== 'box' || typeof msg.nonce !== 'string' || typeof msg.c !== 'string') {
        logInfo(`[WS] reply box error | reason=encryption_required | got.t=${msg.t}`);
        return trySendSecure(ws, {
            t: 'error',
            reason: 'encryption_required',
            message: 'Send { t: "box", nonce, c } with libsodium crypto_box ciphertext',
        });
    }

    let inner;
    try {
        inner = decryptFromClient(ws, msg.nonce, msg.c);
    } catch (e) {
        logError('box decrypt failed', e);
        return trySendSecure(ws, {
            t: 'error',
            reason: 'decrypt_failed',
            message: 'Could not decrypt or parse inner JSON',
        });
    }

    if (!inner || typeof inner !== 'object' || typeof inner.t !== 'string') {
        return trySendSecure(ws, {
            t: 'error',
            reason: 'invalid_inner',
            message: 'Inner payload must be JSON with string field t',
        });
    }

    if (inner.t === 'ping') {
        return trySendSecure(ws, {
            t: 'error',
            reason: 'ping_must_be_plaintext',
            message: 'Use plaintext { t: "ping" } without box',
        });
    }

    {
        const pin = typeof inner.code === 'string' ? inner.code : '—';
        if (inner.t === 'signal' || inner.t === 'msg') {
            logInfo(`[WS] box | relay | inner.t=${inner.t} | pin=${pin}`);
        } else {
            logInfo(`[WS] box | zahtjev | inner.t=${inner.t} | pin=${pin}`);
        }
    }

    switch (inner.t) {
        case 'join':
            return handleJoin(ws, inner);

        case 'signal':
            return handleSignal(ws, inner);

        case 'msg':
            return handleMessage(ws, inner);

        case 'close_session':
            return handleCloseSession(ws, inner);

        case 'ping_self':
            return handlePingSelf(ws, inner);

        case 'peer_ping':
            return handlePeerPing(ws, inner);

        case 'peer_pong':
            return handlePeerPong(ws, inner);

        case 'e2e_ready':
            return handleE2eReady(ws, inner);

        case 'inside_confirm':
            return handleInsideConfirm(ws, inner);

        case 'inside_hybrid':
            return handleInsideHybrid(ws, inner);

        default:
            logInfo(`[WS] box | unknown inner.t=${inner.t} | pin=${typeof inner.code === 'string' ? inner.code : '—'}`);
            trySendSecure(ws, { t: 'error', reason: 'unknown_type' });
    }
}

module.exports = { routeMessage };
