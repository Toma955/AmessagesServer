const { sendJson } = require('../httpUtils');
const pkg = require('../../../package.json');
const {
    isValidCategory,
    catalogForCategory,
    itemById,
    itemByIdNumber,
    manifestForItem: baseManifestForItem,
    validateIdNumber,
    itemDetailResponse,
    ID_NUMBER_RANGES,
} = require('../../market/marketCatalog');
const { packageInfoForItem, readPackageBuffer } = require('../../market/marketPackages');

function manifestForItem(item) {
    const manifest = baseManifestForItem(item);
    const pkg = packageInfoForItem(item);
    if (!pkg) {
        return manifest;
    }
    return {
        ...manifest,
        downloadUrl: pkg.downloadUrl,
        sha256: pkg.sha256,
        sizeBytes: pkg.sizeBytes,
    };
}

/**
 * Nilternius Market API — M1–M5, M-ID
 */
class MarketRoutes {
    canHandle(req, pathname) {
        if (req.method !== 'GET') return false;
        if (pathname === '/api/market/ping') return true;
        if (pathname === '/api/market/catalog') return true;
        if (pathname === '/api/market/id-number/validate') return true;
        if (pathname === '/api/market/id-number/ranges') return true;
        if (/^\/api\/market\/items\/by-id-number\/\d+$/.test(pathname)) return true;
        if (/^\/api\/market\/items\/[^/]+\/versions\/[^/]+\/manifest$/.test(pathname)) return true;
        if (/^\/api\/market\/items\/[^/]+\/packages\/[^/]+$/.test(pathname)) return true;
        if (/^\/api\/market\/items\/[^/]+$/.test(pathname)) return true;
        return false;
    }

    handle(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const { pathname } = url;

        if (pathname === '/api/market/ping') {
            return sendJson(res, 200, {
                ok: true,
                service: 'nilternius-market',
                version: pkg.version || '1.0.0',
            });
        }

        if (pathname === '/api/market/catalog') {
            const category = url.searchParams.get('category');
            if (!category || !isValidCategory(category)) {
                return sendJson(res, 400, { error: 'invalid_category' });
            }
            const items = catalogForCategory(category);
            return sendJson(res, 200, { category: category.toLowerCase(), items });
        }

        if (pathname === '/api/market/id-number/validate') {
            const raw = url.searchParams.get('number');
            if (raw === null || raw === '') {
                return sendJson(res, 400, { valid: false, reason: 'not_numeric' });
            }
            return sendJson(res, 200, validateIdNumber(raw));
        }

        if (pathname === '/api/market/id-number/ranges') {
            return sendJson(res, 200, { ranges: ID_NUMBER_RANGES });
        }

        const byIdNumberMatch = pathname.match(/^\/api\/market\/items\/by-id-number\/(\d+)$/);
        if (byIdNumberMatch) {
            const item = itemByIdNumber(byIdNumberMatch[1]);
            if (!item) {
                return sendJson(res, 404, { error: 'id_number_not_found' });
            }
            return sendJson(res, 200, itemDetailResponse(item));
        }

        const manifestMatch = pathname.match(/^\/api\/market\/items\/([^/]+)\/versions\/([^/]+)\/manifest$/);
        if (manifestMatch) {
            const item = itemById(decodeURIComponent(manifestMatch[1]));
            if (!item || item.version !== decodeURIComponent(manifestMatch[2])) {
                return sendJson(res, 404, { error: 'not_found' });
            }
            return sendJson(res, 200, manifestForItem(item));
        }

        const packageMatch = pathname.match(/^\/api\/market\/items\/([^/]+)\/packages\/([^/]+)$/);
        if (packageMatch) {
            const itemId = decodeURIComponent(packageMatch[1]);
            const version = decodeURIComponent(packageMatch[2]);
            const item = itemById(itemId);
            if (!item || item.version !== version) {
                return sendJson(res, 404, { error: 'not_found' });
            }
            const buffer = readPackageBuffer(itemId, version);
            if (!buffer) {
                return sendJson(res, 404, {
                    error: 'package_not_hosted',
                    message: 'No downloadable package for this item.',
                });
            }
            res.writeHead(200, {
                'Content-Type': 'application/octet-stream',
                'Cache-Control': 'no-store',
                'Content-Length': buffer.length,
            });
            res.end(buffer);
            return undefined;
        }

        const itemMatch = pathname.match(/^\/api\/market\/items\/([^/]+)$/);
        if (itemMatch) {
            const item = itemById(decodeURIComponent(itemMatch[1]));
            if (!item) {
                return sendJson(res, 404, { error: 'not_found' });
            }
            return sendJson(res, 200, itemDetailResponse(item));
        }

        return sendJson(res, 404, { error: 'not_found' });
    }
}

module.exports = { MarketRoutes };
