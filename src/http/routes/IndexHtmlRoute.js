/**
 * GET / — statički index (ako postoji public/index.html).
 */
class IndexHtmlRoute {
    constructor({ indexHtml }) {
        this.indexHtml = indexHtml;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/';
    }

    handle(_req, res) {
        if (this.indexHtml) {
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
                Pragma: 'no-cache',
                // Sprječava automatski scroll na #:~:text=... (npr. iz rezultata pretrage).
                'Document-Policy': 'force-load-at-top',
            });
            return res.end(this.indexHtml);
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Index not available');
    }
}

module.exports = { IndexHtmlRoute };
