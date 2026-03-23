const { logInfo } = require('../utils/logger');
const { persistSession, removeSessionRecord, replaceAllSessionsFromMemory, sessionCodeExists } = require('../db/sessionStore');
const { randomRoomCode16 } = require('../utils/generateRoomCode');
const { sendSecure } = require('../crypto/boxChannel');
const { RESERVE_MS } = require('./roomConstants');

// code -> session
// session = { code, type, clients, createdAt }
const sessions = new Map();

// ws -> code
const socketRoom = new Map();

/** Kratkotrajna rezervacija koda iz GET /api/room-code (ms -> istek). */
const reservedCodes = new Map();

function cleanupReservedCodes() {
    const now = Date.now();
    for (const [code, exp] of reservedCodes) {
        if (exp < now) reservedCodes.delete(code);
    }
}

function releaseReservedCode(code) {
    reservedCodes.delete(code);
}

function createSession(code, mode) {
    const createdAt = new Date();
    const session = {
        code,
        type: mode === 'group' ? 'group' : 'direct',
        clients: new Set(),
        createdAt,
        renewCount: 0,
        /** direct: nakon što jedan od dvojice ode, PIN je zaključan za nove dok zadnji ne ode. */
        directPinLocked: false,
        /** tko je javio E2E spreman (WebSocket); kad su oba u direct → hibernacija. */
        e2eReadyFrom: new Set(),
        /** manje DB upisa dok klijenti koriste isključivo E2E kanal */
        hibernated: false,
    };
    sessions.set(code, session);
    logInfo(`[room] OPEN (nova sesija) | pin=${code} | type=${session.type} | created=${createdAt.toISOString()}`);
    return session;
}

/** Bilo koja aktivnost nakon E2E-hibernacije: puni rad servera + upis u bazu. */
function wakeSessionByCode(code) {
    const session = sessions.get(code);
    if (!session || !session.hibernated) return;
    session.hibernated = false;
    if (session.e2eReadyFrom) {
        session.e2eReadyFrom.clear();
    }
    logInfo(`[room] WAKE (kraj hibernacije) | pin=${code}`);
    persistSession(session, true);
}

// poziva se kad netko šalje join
function joinRoom(ws, code, mode = 'direct') {
    let session = sessions.get(code);

    if (!session) {
        session = createSession(code, mode);
        logInfo(`[room] prvi klijent otvara novu sobu | pin=${code} | type=${session.type}`);
    }

    if (session.hibernated) {
        wakeSessionByCode(code);
        session = sessions.get(code);
    }

    const preSize = session.clients.size;

    if (session.type === 'direct' && session.directPinLocked) {
        sendSecure(ws, {
            t: 'error',
            code,
            reason: 'pin_occupied',
            message: 'PIN is locked until the remaining participant leaves the room',
        });
        logInfo(`[join] ODBIJEN pin_occupied | pin=${code} | direct PIN zaključan za nove`);
        return false;
    }

    if (session.type === 'direct' && preSize >= 2) {
        sendSecure(ws, {
            t: 'error',
            code,
            reason: 'room_full',
            message: 'Direct room already has 2 clients',
        });
        logInfo(`[join] ODBIJEN room_full | pin=${code} | direct soba već ima 2 klijenta`);
        return false;
    }

    session.clients.add(ws);
    socketRoom.set(ws, code);
    releaseReservedCode(code);

    if (preSize === 0) {
        logInfo(`[join] USPJEH | pin=${code} | klijent #1 | peers=${session.clients.size} | roomState=${session.type === 'direct' ? 'waiting_peer' : 'active'}`);
    } else if (preSize === 1 && session.type === 'direct') {
        logInfo(`[join] USPJEH | pin=${code} | klijent #2 (direct povezan) | peers=${session.clients.size} | roomState=connected`);
    } else {
        logInfo(`[join] USPJEH | pin=${code} | group +1 | peers=${session.clients.size}`);
    }

    const peersInRoom = session.clients.size;
    let roomState;
    if (session.type === 'direct') {
        roomState = peersInRoom === 1 ? 'waiting_peer' : 'connected';
    } else {
        roomState = 'active';
    }

    sendSecure(ws, {
        t: 'joined',
        code,
        mode: session.type,
        roomState,
        peersInRoom,
    });

    if (session.type === 'direct' && session.clients.size === 2) {
        logInfo(`[room] session_ready poslano obama | pin=${code} | direct oba klijenta povezana`);
        for (const client of session.clients) {
            if (client.readyState === client.OPEN) {
                sendSecure(client, {
                    t: 'session_ready',
                    code,
                    roomState: 'connected',
                    peersInRoom: 2,
                });
            }
        }
    }

    persistSession(session);

    return true;
}

function removeSession(code) {
    const session = sessions.get(code);
    if (!session) return;

    for (const client of session.clients) {
        socketRoom.delete(client);
    }

    sessions.delete(code);
    removeSessionRecord(code);
    logInfo(`[room] ZATVORENO (prazna soba, brisanje iz RAM+DB) | pin=${code}`);
}

/**
 * Eksplicitno zatvaranje sobe: jedan klijent zatraži, svi se uklanjaju iz sobe.
 * Inicijator dobije closedBy: 'self', ostali 'peer'.
 */
function closeSessionByClient(ws, code) {
    const room = socketRoom.get(ws);
    if (!room || room !== code) {
        return { ok: false, reason: 'not_in_room' };
    }

    const session = sessions.get(code);
    if (!session || !session.clients.has(ws)) {
        return { ok: false, reason: 'not_in_room' };
    }

    const clients = [...session.clients];

    for (const client of clients) {
        socketRoom.delete(client);
    }
    sessions.delete(code);
    removeSessionRecord(code);

    for (const client of clients) {
        if (client.readyState === client.OPEN) {
            sendSecure(client, {
                t: 'session_closed',
                code,
                closedBy: client === ws ? 'self' : 'peer',
            });
        }
    }

    logInfo(`[room] ZATVORENO (close_session zahtjev) | pin=${code} | klijenata bilo=${clients.length}`);
    return { ok: true };
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

    const preSize = session.clients.size;

    session.clients.delete(ws);
    socketRoom.delete(ws);

    if (session.e2eReadyFrom) {
        session.e2eReadyFrom.delete(ws);
    }
    if (session.type === 'direct' && session.clients.size < 2) {
        session.hibernated = false;
    }

    if (session.type === 'direct' && preSize === 2 && session.clients.size === 1) {
        session.directPinLocked = true;
        logInfo(`[room] PIN zaključan (ostao 1 u directu) | pin=${code}`);
    }

    logInfo(`[leave] klijent napušta sobu | pin=${code} | type=${session.type} | bilo_peers=${preSize} | ostalo_peers=${session.clients.size}`);

    if (session.clients.size === 0) {
        logInfo(`[room] zadnji klijent otišao → brisanje sesije | pin=${code}`);
        removeSession(code);
    } else {
        persistSession(session, true);
    }
}

/** Sesija ako je ovaj WebSocket u toj sobi; inače null. */
function getSessionForClientInRoom(ws, code) {
    if (typeof code !== 'string') return null;
    if (socketRoom.get(ws) !== code) return null;
    return sessions.get(code) || null;
}

// broadcast unutar sobe (payload = objekt koji se šalje u box svakom primatelju)
function broadcastToRoom(code, fromWs, payloadObj) {
    const session = sessions.get(code);
    if (!session) return;

    for (const client of session.clients) {
        if (client !== fromWs && client.readyState === client.OPEN) {
            sendSecure(client, payloadObj);
        }
    }
}

/** Popis aktivnih soba iz RAM-a (stvarni WebSocket klijenti). */
function listActiveRooms() {
    const out = [];
    for (const session of sessions.values()) {
        out.push({
            pin: session.code,
            type: session.type,
            clientCount: session.clients.size,
            createdAt: session.createdAt.toISOString(),
            pinLocked: session.type === 'direct' && !!session.directPinLocked,
            hibernated: !!session.hibernated,
        });
    }
    return out.sort((a, b) => a.pin.localeCompare(b.pin));
}

/**
 * Detaljna provjera: RAM (aktivna sesija), SQLite, kratka rezervacija nakon GET /api/room-code.
 */
function getRoomCodeAvailabilityDetails(code) {
    cleanupReservedCodes();
    const inMemorySession = sessions.has(code);
    const inDatabase = sessionCodeExists(code);
    const exp = reservedCodes.get(code);
    const reserved = exp !== undefined && exp > Date.now();
    const occupied = inMemorySession || inDatabase || reserved;
    return {
        inMemorySession,
        inDatabase,
        reserved,
        occupied,
        available: !occupied,
    };
}

function isRoomCodeTaken(code) {
    return getRoomCodeAvailabilityDetails(code).occupied;
}

/**
 * Novi jedinstveni 16-znakovni kod (miješani znakovi); rezerviran ~5 min do joina.
 */
function allocateUniqueRoomCode() {
    for (let attempt = 0; attempt < 256; attempt += 1) {
        const code = randomRoomCode16();
        if (!isRoomCodeTaken(code)) {
            reservedCodes.set(code, Date.now() + RESERVE_MS);
            return code;
        }
    }
    throw new Error('Could not allocate a unique room code');
}

/** Puna sinkronizacija: SQLite tablica = točno stanje aktivnih sesija u RAM-u. */
function syncAllSessionsToDatabase() {
    const now = new Date().toISOString();
    const rows = [];
    for (const session of sessions.values()) {
        rows.push({
            code: session.code,
            type: session.type,
            created_at: session.createdAt instanceof Date
                ? session.createdAt.toISOString()
                : session.createdAt,
            renew_count: session.renewCount,
            client_count: session.clients.size,
            updated_at: now,
        });
    }
    logInfo(`[db] SQLite sync (replace all) | aktivnih_sesija=${rows.length}`);
    replaceAllSessionsFromMemory(rows);
}

/** Za logiranje pri WS close: koji PIN je klijent imao prije leaveRoom. */
function getRoomCodeForWs(ws) {
    return socketRoom.get(ws) || null;
}

module.exports = {
    joinRoom,
    leaveRoom,
    broadcastToRoom,
    getSessionForClientInRoom,
    wakeSessionByCode,
    closeSessionByClient,
    listActiveRooms,
    isRoomCodeTaken,
    getRoomCodeAvailabilityDetails,
    allocateUniqueRoomCode,
    syncAllSessionsToDatabase,
    getRoomCodeForWs,
};
