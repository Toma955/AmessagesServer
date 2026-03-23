const { logInfo } = require('../utils/logger');
const { getWsTransportMeta } = require('../utils/wsTransportMeta');
const { persistSession, removeSessionRecord, replaceAllSessionsFromMemory, sessionCodeExists } = require('../db/sessionStore');
const { randomRoomCode16 } = require('../utils/generateRoomCode');
const { sendSecure } = require('../crypto/boxChannel');
const { RESERVE_MS } = require('./roomConstants');
const { pushRoomEvent, clearRoomDiagnostics } = require('./roomDiagnostics');

/**
 * Uparivanje u sobu isključivo po PIN-u (string koda). IP, port i X-Forwarded-For
 * idu samo u RAM evidenciju — ne filtriraju tko smije ući.
 */

// code -> session
// session = { code, type, clients, createdAt, clientTransportByWs, ... }
const sessions = new Map();

/** Zadnji join zapisi po PIN-u (samo RAM; briše se s obradom sesije). */
const pinJoinRamLedger = new Map();

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

function appendJoinLedgerEntry(code, entry) {
    const arr = pinJoinRamLedger.get(code);
    if (arr) {
        arr.push(entry);
    } else {
        pinJoinRamLedger.set(code, [entry]);
    }
}

/** @param {import('ws')} ws */
function registerPeerInRamLedger(session, ws, code) {
    if (!session.clientTransportByWs) {
        session.clientTransportByWs = new Map();
    }
    const meta = getWsTransportMeta(ws);
    const registeredAt = new Date().toISOString();
    session.clientTransportByWs.set(ws, { ...meta, registeredAt });
    const wsLabel = ws._clientId != null ? `ws${ws._clientId}` : 'ws?';
    appendJoinLedgerEntry(code, {
        at: registeredAt,
        wsId: ws._clientId ?? null,
        remoteAddress: meta.remoteAddress,
        remotePort: meta.remotePort,
        forwardedFor: meta.forwardedFor,
    });
    const peerIndex = session.clients.size;
    logInfo(`[join] RAM spremište (ledger) | pin=${code} | red=${peerIndex} | ip=${meta.remoteAddress ?? '—'} | port=${meta.remotePort ?? '—'} | xff=${meta.forwardedFor ?? '—'} | ${wsLabel}`);
}

function createSession(code, mode) {
    const createdAt = new Date();
    const session = {
        code,
        type: mode === 'group' ? 'group' : 'direct',
        clients: new Set(),
        /** @type {Map<import('ws'), { remoteAddress: string | null, remotePort: number | null, forwardedFor: string | null, registeredAt: string }>} */
        clientTransportByWs: new Map(),
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
    pushRoomEvent(code, 'system', `Nova sesija: tip=${session.type}. Čeka se prvi klijent (strana A).`);
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
    pushRoomEvent(code, 'system', 'Soba izlazi iz hibernacije (nova aktivnost).');
    persistSession(session, true);
}

// poziva se kad netko šalje join
function joinRoom(ws, code, mode = 'direct') {
    const existingCode = socketRoom.get(ws);
    if (existingCode === code) {
        const sess = sessions.get(code);
        if (sess && sess.clients.has(ws)) {
            const peersInRoom = sess.clients.size;
            let roomState;
            if (sess.type === 'direct') {
                roomState = peersInRoom === 1 ? 'waiting_peer' : 'connected';
            } else {
                roomState = 'active';
            }
            sendSecure(ws, {
                t: 'joined',
                code,
                mode: sess.type,
                roomState,
                peersInRoom,
            });
            if (sess.type === 'direct' && peersInRoom === 2) {
                for (const client of sess.clients) {
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
            logInfo(`[join] idempotent (isti WebSocket već u sobi) | pin=${code} | peers=${peersInRoom}`);
            return true;
        }
    }
    if (existingCode && existingCode !== code) {
        logInfo(`[join] napuštanje prethodne sobe pri joinu na drugi PIN | stari_pin=${existingCode} | novi_pin=${code}`);
        leaveRoom(ws);
    }

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
        pushRoomEvent(code, 'system', 'Join odbijen: PIN zaključan dok jedan peer ostane u sobi.');
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
        pushRoomEvent(code, 'system', 'Join odbijen: direct soba puna (2/2).');
        return false;
    }

    session.clients.add(ws);
    socketRoom.set(ws, code);
    releaseReservedCode(code);
    registerPeerInRamLedger(session, ws, code);

    if (preSize === 0) {
        logInfo(`[join] USPJEH | pin=${code} | klijent #1 | peers=${session.clients.size} | roomState=${session.type === 'direct' ? 'waiting_peer' : 'active'}`);
        pushRoomEvent(code, 'join', session.type === 'direct'
            ? 'Strana A (prvi klijent): spojen. Čeka se drugi peer (strana B).'
            : 'Prvi klijent u group sobi spojen.');
        if (session.type === 'direct') {
            pushRoomEvent(code, 'system', 'Za B: drugi uređaj ili druga app mora otvoriti svoju WebSocket vezu na isti server i poslati isti PIN — jedna veza = jedan klijent (SQLite/RAM ne mogu dodati drugog bez drugog joina).');
        }
    } else if (preSize === 1 && session.type === 'direct') {
        logInfo(`[join] USPJEH | pin=${code} | klijent #2 (direct povezan) | peers=${session.clients.size} | roomState=connected | isti_PIN_soba_spojena`);
        pushRoomEvent(code, 'join', 'Strana B (drugi klijent): spojen — oba u direct sobi (session_ready).');
    } else {
        logInfo(`[join] USPJEH | pin=${code} | group +1 | peers=${session.clients.size}`);
        pushRoomEvent(code, 'join', `Novi klijent u group sobi (ukupno ${session.clients.size} peerova).`);
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
        pushRoomEvent(code, 'system', 'session_ready: oba klijenta mogu razmjenjivati signale/poruke.');
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

    pushRoomEvent(code, 'system', 'Soba uklonjena (zadnji klijent otišao).');
    clearRoomDiagnostics(code);

    for (const client of session.clients) {
        socketRoom.delete(client);
    }

    sessions.delete(code);
    pinJoinRamLedger.delete(code);
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

    pushRoomEvent(code, 'system', 'close_session: jedan klijent zatvara cijelu sobu za sve.');

    for (const client of clients) {
        socketRoom.delete(client);
    }
    sessions.delete(code);
    pinJoinRamLedger.delete(code);
    removeSessionRecord(code);

    clearRoomDiagnostics(code);

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
    const clientsBefore = [...session.clients];
    const leftIdx = clientsBefore.indexOf(ws);
    const sideLabel = session.type === 'direct' && leftIdx === 0
        ? 'Strana A (prvi klijent)'
        : session.type === 'direct' && leftIdx === 1
            ? 'Strana B (drugi klijent)'
            : `Klijent #${leftIdx + 1}`;

    session.clients.delete(ws);
    socketRoom.delete(ws);
    if (session.clientTransportByWs) {
        session.clientTransportByWs.delete(ws);
    }

    pushRoomEvent(code, 'leave', `${sideLabel} odspojen. Ostalo peerova: ${session.clients.size}.`);

    if (session.e2eReadyFrom) {
        session.e2eReadyFrom.delete(ws);
    }
    if (session.type === 'direct' && session.clients.size < 2) {
        session.hibernated = false;
    }

    if (session.type === 'direct' && preSize === 2 && session.clients.size === 1) {
        session.directPinLocked = true;
        logInfo(`[room] PIN zaključan (ostao 1 u directu) | pin=${code}`);
        pushRoomEvent(code, 'system', 'Direct: ostao jedan peer — PIN zaključan za nove dok ne ode i zadnji.');
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
        const peers = [...session.clients].map((c, slot) => {
            const t = session.clientTransportByWs && session.clientTransportByWs.get(c);
            return {
                slot,
                wsId: c._clientId ?? null,
                remoteAddress: t ? t.remoteAddress : null,
                remotePort: t ? t.remotePort : null,
                forwardedFor: t ? t.forwardedFor : null,
                registeredAt: t ? t.registeredAt : null,
            };
        });
        out.push({
            pin: session.code,
            type: session.type,
            clientCount: session.clients.size,
            createdAt: session.createdAt.toISOString(),
            pinLocked: session.type === 'direct' && !!session.directPinLocked,
            hibernated: !!session.hibernated,
            peers,
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

/**
 * Admin: nasilno zatvori WebSocket jedne strane u directu (prvi u Setu = A, drugi = B).
 * @param {'first'|'second'} slot
 */
function forceDisconnectClientBySlot(code, slot) {
    const session = sessions.get(code);
    if (!session) {
        return { ok: false, reason: 'no_room' };
    }
    if (slot !== 'first' && slot !== 'second') {
        return { ok: false, reason: 'bad_slot' };
    }
    const clients = [...session.clients];
    const idx = slot === 'first' ? 0 : 1;
    if (idx >= clients.length) {
        return { ok: false, reason: 'no_peer' };
    }
    const ws = clients[idx];
    const sideLabel = slot === 'first' ? 'A (prvi klijent)' : 'B (drugi klijent)';
    pushRoomEvent(code, 'system', `Administrator: prekid veze za stranu ${sideLabel}.`);
    try {
        ws.close(4400, 'admin_disconnect');
    } catch {
        return { ok: false, reason: 'close_failed' };
    }
    return { ok: true };
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
    forceDisconnectClientBySlot,
};
