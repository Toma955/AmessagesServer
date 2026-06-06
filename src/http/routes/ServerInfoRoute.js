const { sendJson } = require('../httpUtils');
const pkg = require('../../../package.json');

/**
 * GET /api/server/info — W1
 */
class ServerInfoRoute {
    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/server/info';
    }

    handle(_req, res) {
        sendJson(res, 200, {
            service: 'amessages-server',
            version: pkg.version || '1.0.0',
            protocols: ['ws-v1', 'inside-v1', 'box-v1'],
            maintenance: false,
            serverTime: new Date().toISOString(),
        });
    }
}

module.exports = { ServerInfoRoute };
