const { logInfo } = require('../utils/logger');

/**
 * Lanac HTTP ruta: prva koja prihvati zahtjev obrađuje ga; inače 404.
 */
class HttpPipeline {
    /**
     * @param {Array<{ canHandle: (req: import('http').IncomingMessage, pathname: string) => boolean, handle: (req: import('http').IncomingMessage, res: import('http').ServerResponse) => void }>} routes
     */
    constructor(routes) {
        this.routes = routes;
    }

    /** @returns {import('http').RequestListener} */
    createListener() {
        return (req, res) => {
            let pathname;
            try {
                pathname = new URL(req.url, 'http://localhost').pathname;
            } catch {
                logInfo('[HTTP] bad URL → 400');
                res.writeHead(400);
                res.end();
                return;
            }

            logInfo(`[HTTP] → ${req.method} ${pathname}`);
            res.on('finish', () => {
                logInfo(`[HTTP] ← ${req.method} ${pathname} status=${res.statusCode}`);
            });

            for (const route of this.routes) {
                if (route.canHandle(req, pathname)) {
                    route.handle(req, res);
                    return;
                }
            }
            logInfo(`[HTTP] → ${req.method} ${pathname} (no route) → 404`);
            res.writeHead(404);
            res.end();
        };
    }
}

module.exports = { HttpPipeline };
