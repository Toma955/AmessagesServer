const { logInfo } = require('../utils/logger');

const SESSION_DURATION_MS = 15 * 60 * 1000;   // 15 min
const WARNING_BEFORE_EXPIRY_MS = 30 * 1000;   // 30 sek prije isteka
const MAX_EXTENDS = 3;

// code -> session
// session = { code, type, clients, createdAt, renewCount, timeoutId, warningTimeoutId }
const sessions = new Map();

// ws -> code
const socketRoom = new Map();

function scheduleSessionTimers(code) {
    const session = sessions.get(code);
    if (!session) return;

    // očisti stare timere
    if (session.timeoutId) clearTimeout(session.timeoutId);
    if (session.warningTimeoutId) clearTimeout(session.warningTimeoutId);

    // warning 30 sekundi prije isteka
    const warningTimeout = setTimeout(() => {
        logInfo('EXTEND_REQUEST auto-send for code', code, 'renewCount', session.renewCount);
        for (const client of session.clients) {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({
                    t: 'extend_request',
                    code,
                    remainingExtensions: MAX_EXTENDS - session.renewCount,
                }));
            }
        }
    }, SESSION_DURATION_MS - WARNING_BEFORE_EXPIRY_MS);
    // da timer ne drži proces živim (bitno za testove)
    warningTimeout.unref();
    session.warningTimeoutId = warningTimeout;

    // timeout na 15 minuta
    const timeout = setTimeout(() => {
        logInfo('SESSION EXPIRED for code', code, '- closing room and notifying clients');
        for (const client of session.clients) {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({
                    t: 'expired',
                    code,
                }));
            }
            socketRoom.delete(client);
        }
        sessions.delete(code);
        logInfo('SESSION REMOVED (expired)', code);
    }, SESSION_DURATION_MS);
    timeout.unref();
    session.timeoutId = timeout;
}

function createSession(code, mode) {
    const createdAt = new Date();
    const session = {
        code,
        type: mode === 'group' ? 'group' : 'direct',
        clients: new Set(),
        createdAt,
        renewCount: 0,
        timeoutId: null,
        warningTimeoutId: null,
    };
    sessions.set(code, session);
    logInfo('New session created', code, 'type', session.type, 'at', createdAt.toISOString());
    scheduleSessionTimers(code);
    return session;
}

// poziva se kad netko šalje join
function joinRoom(ws, code, mode = 'direct') {
    let session = sessions.get(code);

    const isNewSession = !session;
    if (!session) {
        session = createSession(code, mode);
        logInfo('FIRST connection request for code', code, 'mode', session.type);
    }

    const preSize = session.clients.size;

    // direct soba max 2 klijenta
    if (session.type === 'direct' && preSize >= 2) {
        ws.send(JSON.stringify({
            t: 'error',
            code,
            reason: 'room_full',
            message: 'Direct room already has 2 clients',
        }));
        logInfo('JOIN rejected (room_full) for code', code);
        return false;
    }

    session.clients.add(ws);
    socketRoom.set(ws, code);

    if (preSize === 0) {
        logInfo('CLIENT #1 joined session', code, 'current size', session.clients.size);
    } else if (preSize === 1 && session.type === 'direct') {
        logInfo('CLIENT #2 joined session (direct)', code, 'current size', session.clients.size);
    } else {
        logInfo('CLIENT joined group session', code, 'current size', session.clients.size);
    }

    ws.send(JSON.stringify({ t: 'joined', code, mode: session.type }));

    // kad direct soba ima točno 2 klijenta -> session_ready za oboje
    if (session.type === 'direct' && session.clients.size === 2) {
        logInfo('SESSION READY / CONNECTION ESTABLISHED for code', code, '- 2 clients connected');
        for (const client of session.clients) {
            if (client.readyState === client.OPEN) {
                client.send(JSON.stringify({
                    t: 'session_ready',
                    code,
                }));
            }
        }
    }

    return true;
}

function removeSession(code) {
    const session = sessions.get(code);
    if (!session) return;

    if (session.timeoutId) clearTimeout(session.timeoutId);
    if (session.warningTimeoutId) clearTimeout(session.warningTimeoutId);

    for (const client of session.clients) {
        socketRoom.delete(client);
    }

    sessions.delete(code);
    logInfo('SESSION REMOVED (empty)', code);
}

// kad se ws zatvori
function leaveRoom(ws) {
    const code = socketRoom.get(ws);
    if (!code) return;

    const session = sessions.get(code);
    if (!session) {
        socketRoom.delete(ws);
        return;
    }

    session.clients.delete(ws);
    socketRoom.delete(ws);

    logInfo('CLIENT left session', code, 'current size', session.clients.size);

    if (session.clients.size === 0) {
        logInfo('LAST CLIENT left, closing session', code);
        removeSession(code);
    }
}

// broadcast unutar sobe
function broadcastToRoom(code, fromWs, payload) {
    const session = sessions.get(code);
    if (!session) return;

    for (const client of session.clients) {
        if (client !== fromWs && client.readyState === client.OPEN) {
            client.send(payload);
        }
    }
}

// produženje sessiona
function extendSession(ws, code) {
    const session = sessions.get(code);
    if (!session) {
        ws.send(JSON.stringify({
            t: 'error',
            reason: 'no_room',
            message: 'Room does not exist',
        }));
        logInfo('EXTEND refused (no_room) for code', code);
        return;
    }

    if (session.renewCount >= MAX_EXTENDS) {
        ws.send(JSON.stringify({
            t: 'error',
            reason: 'max_extensions',
            message: 'Maximum extensions reached',
        }));
        logInfo('EXTEND refused (max_extensions) for code', code);
        return;
    }

    session.renewCount += 1;
    logInfo('Session extended', code, 'renewCount', session.renewCount);

    scheduleSessionTimers(code);

    for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
            client.send(JSON.stringify({
                t: 'extended',
                code,
                renewCount: session.renewCount,
            }));
        }
    }
}

module.exports = {
    joinRoom,
    leaveRoom,
    broadcastToRoom,
    extendSession,
};
