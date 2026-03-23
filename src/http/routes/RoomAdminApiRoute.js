const { readRequestBody, sendJson } = require('../httpUtils');
const { getRoomEvents, attachRoomEventStream } = require('../../core/roomDiagnostics');
const { forceDisconnectClientBySlot } = require('../../core/roomManager');

/**
 * GET  /api/rooms/:pin/events        — JSON povijest događaja za tu sobu
 * GET  /api/rooms/:pin/events/stream — SSE (uživo)
 * POST /api/rooms/:pin/disconnect    — body { "slot": "first" | "second" } (direct: prvi = A, drugi = B)
 */
class RoomAdminApiRoute {
    constructor({ isValidCode, getAdminToken, logInfo, logError }) {
        this.isValidCode = isValidCode;
        this.getAdminToken = getAdminToken;
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        const ev = pathname.match(/^\/api\/rooms\/[^/]+\/events(?:\/stream)?$/);
        if (ev && req.method === 'GET') return true;
        const disc = pathname.match(/^\/api\/rooms\/[^/]+\/disconnect$/);
        return !!(disc && req.method === 'POST');
    }

    /** @param {import('http').IncomingMessage} req */
    checkAdmin(req, res) {
        const token = this.getAdminToken && this.getAdminToken();
        if (!token) return true;
        const auth = req.headers.authorization || '';
        const hdr = req.headers['x-admin-token'];
        let q;
        try {
            q = new URL(req.url, 'http://localhost').searchParams.get('admin_token');
        } catch {
            q = null;
        }
        const ok = auth === `Bearer ${token}` || hdr === token || q === token;
        if (!ok) {
            sendJson(res, 401, { error: 'unauthorized', message: 'Set ADMIN_TOKEN or send Authorization: Bearer / X-Admin-Token / ?admin_token=' });
            return false;
        }
        return true;
    }

    handle(req, res) {
        const pathname = new URL(req.url, 'http://localhost').pathname;
        const ev = pathname.match(/^\/api\/rooms\/([^/]+)\/events(?:\/(stream))?$/);
        if (ev && req.method === 'GET') {
            const pin = decodeURIComponent(ev[1]);
            const stream = ev[2] === 'stream';
            return stream ? this.handleSse(req, res, pin) : this.handleEventsJson(req, res, pin);
        }
        const disc = pathname.match(/^\/api\/rooms\/([^/]+)\/disconnect$/);
        if (disc && req.method === 'POST') {
            return this.handleDisconnect(req, res, decodeURIComponent(disc[1]));
        }
        res.writeHead(404);
        res.end();
    }

    handleEventsJson(req, res, pin) {
        if (!this.checkAdmin(req, res)) return;
        if (!this.isValidCode(pin)) {
            return sendJson(res, 400, { error: 'invalid_pin' });
        }
        try {
            const events = getRoomEvents(pin);
            return sendJson(res, 200, { pin, events });
        } catch (err) {
            this.logError('GET room events', err);
            return sendJson(res, 500, { error: 'internal_error' });
        }
    }

    handleSse(req, res, pin) {
        if (!this.checkAdmin(req, res)) return;
        if (!this.isValidCode(pin)) {
            res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('invalid_pin');
            return;
        }
        try {
            this.logInfo(`[HTTP] SSE konzola sobe | pin=${pin}`);
            attachRoomEventStream(res, pin);
        } catch (err) {
            this.logError('SSE room events', err);
            if (!res.headersSent) {
                res.writeHead(500);
                res.end();
            }
        }
    }

    handleDisconnect(req, res, pin) {
        if (!this.checkAdmin(req, res)) return;
        if (!this.isValidCode(pin)) {
            return sendJson(res, 400, { error: 'invalid_pin' });
        }
        readRequestBody(req)
            .then((body) => {
                try {
                    let parsed;
                    try {
                        parsed = JSON.parse(body || '{}');
                    } catch {
                        return sendJson(res, 400, { error: 'invalid_json' });
                    }
                    const slot = parsed.slot;
                    if (slot !== 'first' && slot !== 'second') {
                        return sendJson(res, 400, { error: 'bad_slot', message: 'slot must be "first" or "second"' });
                    }
                    const result = forceDisconnectClientBySlot(pin, slot);
                    if (!result.ok) {
                        return sendJson(res, 400, { error: result.reason || 'failed' });
                    }
                    this.logInfo(`[HTTP] admin disconnect | pin=${pin} | slot=${slot}`);
                    return sendJson(res, 200, { ok: true, pin, slot });
                } catch (err) {
                    this.logError('POST disconnect', err);
                    return sendJson(res, 500, { error: 'internal_error' });
                }
            })
            .catch((err) => {
                this.logError('POST body disconnect', err);
                sendJson(res, 500, { error: 'internal_error' });
            });
    }
}

module.exports = { RoomAdminApiRoute };
