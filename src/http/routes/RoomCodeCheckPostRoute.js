const { readRequestBody, sendJson } = require('../httpUtils');

/**
 * POST /api/room-code/check — JSON { code }
 */
class RoomCodeCheckPostRoute {
    constructor({ isValidCode, getRoomCodeAvailabilityDetails, logInfo, logError }) {
        this.isValidCode = isValidCode;
        this.getRoomCodeAvailabilityDetails = getRoomCodeAvailabilityDetails;
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'POST' && pathname === '/api/room-code/check';
    }

    handle(req, res) {
        readRequestBody(req)
            .then((body) => {
                try {
                    let parsed;
                    try {
                        parsed = JSON.parse(body || '{}');
                    } catch {
                        this.logInfo('[HTTP] POST /api/room-code/check | greška: nevaljan JSON');
                        return sendJson(res, 400, { error: 'invalid_json' });
                    }
                    const code = parsed.code;
                    if (typeof code !== 'string' || code === '') {
                        this.logInfo('[HTTP] POST /api/room-code/check | greška: nedostaje string polje code u bodyju');
                        return sendJson(res, 400, {
                            valid: false,
                            available: false,
                            error: 'missing_code',
                            message: 'JSON body must include string field code',
                        });
                    }
                    if (!this.isValidCode(code)) {
                        this.logInfo(`[HTTP] POST /api/room-code/check | pin=${code} | nevaljan format`);
                        return sendJson(res, 200, {
                            code,
                            valid: false,
                            available: false,
                            occupied: true,
                            reason: 'invalid_format',
                            message: 'Code must be exactly 16 printable ASCII characters',
                        });
                    }
                    const details = this.getRoomCodeAvailabilityDetails(code);
                    this.logInfo(`[HTTP] POST /api/room-code/check | pin=${code} | occupied=${details.occupied} | RAM=${details.inMemorySession} | DB=${details.inDatabase} | rezervacija=${details.reserved}`);
                    return sendJson(res, 200, {
                        code,
                        valid: true,
                        occupied: details.occupied,
                        available: details.available,
                        sources: {
                            inMemorySession: details.inMemorySession,
                            inDatabase: details.inDatabase,
                            reserved: details.reserved,
                        },
                    });
                } catch (err) {
                    this.logError('POST /api/room-code/check failed', err);
                    return sendJson(res, 500, { error: 'internal_error' });
                }
            })
            .catch((err) => {
                this.logError('POST body read failed', err);
                sendJson(res, 500, { error: 'internal_error' });
            });
    }
}

module.exports = { RoomCodeCheckPostRoute };
