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
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(this.indexHtml);
        }
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Index not available');
    }
}

module.exports = { IndexHtmlRoute };
