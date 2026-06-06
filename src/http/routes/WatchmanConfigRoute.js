const { sendJson } = require('../httpUtils');

/**
 * GET /api/watchman/config — W5
 */
class WatchmanConfigRoute {
    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/watchman/config';
    }

    handle(_req, res) {
        sendJson(res, 200, {
            joinTimeoutMs: 30000,
            sessionReadyTimeoutMs: 60000,
            maxPeersPerRoom: 2,
            insideEnabled: true,
            typingEnabled: true,
            voipEnabled: true,
            profileHandshakeEnabled: true,
        });
    }
}

module.exports = { WatchmanConfigRoute };
