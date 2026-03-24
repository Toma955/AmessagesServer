/**
 * Dnevnik događaja po PIN-u sobe (za admin konzolu u pregledniku) + SSE pretplatnici.
 */

const MAX_EVENTS = 500;

/** @type {Map<string, Array<{ ts: string, kind: string, message: string }>>} */
const buffers = new Map();

/** @type {Map<string, Set<{ res: import('http').ServerResponse }>>} */
const sseByCode = new Map();

/**
 * @param {string} code - PIN sobe
 * @param {string} kind - npr. system, join, leave, traffic, e2e
 * @param {string} message
 */
function pushRoomEvent(code, kind, message) {
    const entry = { ts: new Date().toISOString(), kind, message: String(message) };
    let buf = buffers.get(code);
    if (!buf) {
        buf = [];
        buffers.set(code, buf);
    }
    buf.push(entry);
    if (buf.length > MAX_EVENTS) {
        buf.splice(0, buf.length - MAX_EVENTS);
    }

    const subs = sseByCode.get(code);
    if (subs) {
        const payload = JSON.stringify(entry);
        for (const sub of subs) {
            try {
                sub.res.write(`data: ${payload}\n\n`);
            } catch {
                /* veza već zatvorena */
            }
        }
    }
}

function getRoomEvents(code) {
    const buf = buffers.get(code);
    return buf ? [...buf] : [];
}

/**
 * Pošalji povijest i zadrži pretplatu za nova pushRoomEvent.
 */
function attachRoomEventStream(res, code) {
    const events = getRoomEvents(code);
    res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.write('\n');
    for (const e of events) {
        res.write(`data: ${JSON.stringify(e)}\n\n`);
    }

    let subs = sseByCode.get(code);
    if (!subs) {
        subs = new Set();
        sseByCode.set(code, subs);
    }
    const sub = { res };
    subs.add(sub);

    const cleanup = () => {
        subs.delete(sub);
        if (subs.size === 0) {
            sseByCode.delete(code);
        }
    };
    res.on('close', cleanup);
    res.on('end', cleanup);
}

/** Zatvori pretplatu i obriši buffer kad se soba ukloni iz RAM-a. */
function clearRoomDiagnostics(code) {
    const subs = sseByCode.get(code);
    if (subs) {
        for (const sub of subs) {
            try {
                sub.res.end();
            } catch {
                /* */
            }
        }
        sseByCode.delete(code);
    }
    buffers.delete(code);
}

module.exports = {
    pushRoomEvent,
    getRoomEvents,
    attachRoomEventStream,
    clearRoomDiagnostics,
};
