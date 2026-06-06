const { sendJson } = require('../httpUtils');
const { buildSystemComms } = require('../../app/appSystemComms');

/**
 * GET /api/app/system-comms
 *
 * Server ↔ aplikacija: ažuriranja host appa, Market stavki i sistemske obavijesti.
 *
 * Query:
 *   appVersion  — CFBundleShortVersionString
 *   platform    — ios (default)
 *   locale      — hr | en
 *   installed   — URL-encoded JSON niz [{ itemId, category, version }]
 */
class AppSystemCommsRoute {
    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/app/system-comms';
    }

    handle(req, res) {
        const url = new URL(req.url, 'http://localhost');
        const payload = buildSystemComms({
            appVersion: url.searchParams.get('appVersion') || '',
            platform: url.searchParams.get('platform') || 'ios',
            locale: url.searchParams.get('locale') || 'hr',
            installedItemsRaw: url.searchParams.get('installed') || '',
        });
        return sendJson(res, 200, payload);
    }
}

module.exports = { AppSystemCommsRoute };
