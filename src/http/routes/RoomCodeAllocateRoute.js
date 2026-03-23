const { RESERVE_MS } = require('../../core/roomConstants');

/**
 * GET /api/room-code — novi jedinstveni PIN + kratka rezervacija.
 */
class RoomCodeAllocateRoute {
    constructor({ allocateUniqueRoomCode, logInfo, logError }) {
        this.allocateUniqueRoomCode = allocateUniqueRoomCode;
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/room-code';
    }

    handle(_req, res) {
        try {
            const code = this.allocateUniqueRoomCode();
            const minutes = RESERVE_MS / 60000;
            this.logInfo(`[HTTP] GET /api/room-code | novi PIN dodijeljen + rezerviran ~${minutes} min do joina | pin=${code}`);
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify({ code }));
        } catch (err) {
            this.logError('GET /api/room-code failed', err);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'could_not_allocate_code' }));
        }
    }
}

module.exports = { RoomCodeAllocateRoute };
