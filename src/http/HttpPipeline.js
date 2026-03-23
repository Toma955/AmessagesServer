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
                res.writeHead(400);
                res.end();
                return;
            }
            for (const route of this.routes) {
                if (route.canHandle(req, pathname)) {
                    route.handle(req, res);
                    return;
                }
            }
            res.writeHead(404);
            res.end();
        };
    }
}

module.exports = { HttpPipeline };
