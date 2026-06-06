const { sendJson } = require('../httpUtils');

/**
 * GET /api/rooms/:code/status — W3
 */
class RoomStatusRoute {
    constructor({ isValidCode, getRoomPublicStatus, logError }) {
        this.isValidCode = isValidCode;
        this.getRoomPublicStatus = getRoomPublicStatus;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && /^\/api\/rooms\/[^/]+\/status$/.test(pathname);
    }

    handle(req, res) {
        try {
            const parts = req.url.split('?')[0].split('/').filter(Boolean);
            const code = decodeURIComponent(parts[2] || '');
            if (!this.isValidCode(code)) {
                return sendJson(res, 400, { error: 'invalid_code' });
            }
            const status = this.getRoomPublicStatus(code);
            if (!status) {
                return sendJson(res, 404, { error: 'not_found' });
            }
            return sendJson(res, 200, status);
        } catch (err) {
            this.logError('GET /api/rooms/:code/status failed', err);
            return sendJson(res, 500, { error: 'internal_error' });
        }
    }
}

module.exports = { RoomStatusRoute };
