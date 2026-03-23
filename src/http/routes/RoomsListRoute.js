/**
 * GET /api/rooms — aktivne sobe (RAM) + snimak u SQLite.
 */
class RoomsListRoute {
    constructor({ listActiveRooms, listAllSessionsFromDb, logInfo, logError }) {
        this.listActiveRooms = listActiveRooms;
        this.listAllSessionsFromDb = listAllSessionsFromDb;
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/rooms';
    }

    handle(_req, res) {
        try {
            const rooms = this.listActiveRooms();
            const database = this.listAllSessionsFromDb();
            this.logInfo(`[HTTP] GET /api/rooms | aktivnih_soba_RAM=${rooms.length} | redaka_u_bazi=${database.length}`);
            const payload = { rooms, database };
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': 'no-store',
            });
            res.end(JSON.stringify(payload));
        } catch (err) {
            this.logError('GET /api/rooms failed', err);
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'internal_error' }));
        }
    }
}

module.exports = { RoomsListRoute };
