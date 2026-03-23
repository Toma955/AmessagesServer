/**
 * GET /health — lagani healthcheck.
 */
class HealthRoute {
    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/health';
    }

    handle(_req, res) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
    }
}

module.exports = { HealthRoute };
