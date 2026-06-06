const { sendJson } = require('../httpUtils');

/**
 * GET /api/room-code/validate?code=… — W2
 */
class RoomCodeValidateRoute {
    constructor({ validateRoomCodeForJoin, logError }) {
        this.validateRoomCodeForJoin = validateRoomCodeForJoin;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/room-code/validate';
    }

    handle(req, res) {
        try {
            const url = new URL(req.url, 'http://localhost');
            const code = url.searchParams.get('code');
            if (code === null || code === '') {
                return sendJson(res, 400, {
                    valid: false,
                    formatOk: false,
                    available: false,
                    reason: 'missing_code',
                });
            }
            const result = this.validateRoomCodeForJoin(code);
            return sendJson(res, 200, result);
        } catch (err) {
            this.logError('GET /api/room-code/validate failed', err);
            return sendJson(res, 500, { error: 'internal_error' });
        }
    }
}

module.exports = { RoomCodeValidateRoute };
