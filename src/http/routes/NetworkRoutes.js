const { sendJson } = require('../httpUtils');

/**
 * GET /api/network/ping — N2
 * GET /api/network/endpoints — N4
 * GET /api/network/speed-test — N3 (stub chunk)
 */
class NetworkRoutes {
    canHandle(req, pathname) {
        if (req.method !== 'GET') return false;
        return pathname === '/api/network/ping'
            || pathname === '/api/network/endpoints'
            || pathname === '/api/network/speed-test';
    }

    handle(req, res) {
        const pathname = new URL(req.url, 'http://localhost').pathname;

        if (pathname === '/api/network/ping') {
            return sendJson(res, 200, {
                ok: true,
                serverTime: new Date().toISOString(),
                latencyHintMs: 0,
            });
        }

        if (pathname === '/api/network/endpoints') {
            const primary = process.env.PUBLIC_SERVER_URL || 'https://amessagesserver.onrender.com';
            return sendJson(res, 200, {
                primary,
                fallbacks: [],
                marketPrimary: primary,
            });
        }

        if (pathname === '/api/network/speed-test') {
            const url = new URL(req.url, 'http://localhost');
            const bytes = Math.min(
                Math.max(parseInt(url.searchParams.get('bytes') || '65536', 10) || 65536, 1024),
                262144
            );
            const chunk = Buffer.alloc(bytes, 0x2e);
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Content-Length': chunk.length,
            });
            res.end(chunk);
            return undefined;
        }

        sendJson(res, 404, { error: 'not_found' });
        return undefined;
    }
}

module.exports = { NetworkRoutes };
