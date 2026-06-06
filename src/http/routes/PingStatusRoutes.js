const { sendJson } = require('../httpUtils');

/**
 * GET /ping i GET /status — aliasi za healthcheck (Nilternius NetworkManager N1).
 */
class PingStatusRoutes {
    canHandle(req, pathname) {
        return req.method === 'GET' && (pathname === '/ping' || pathname === '/status');
    }

    handle(_req, res) {
        sendJson(res, 200, { status: 'ok', service: 'amessages-server' });
    }
}

module.exports = { PingStatusRoutes };
