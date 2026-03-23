const { sendJson } = require('../httpUtils');

/**
 * GET /api/room-code/check?code=…
 */
class RoomCodeCheckGetRoute {
    constructor({ isValidCode, getRoomCodeAvailabilityDetails, logInfo, logError }) {
        this.isValidCode = isValidCode;
        this.getRoomCodeAvailabilityDetails = getRoomCodeAvailabilityDetails;
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'GET' && pathname === '/api/room-code/check';
    }

    handle(req, res) {
        try {
            const url = new URL(req.url, 'http://localhost');
            const code = url.searchParams.get('code');
            if (code === null || code === '') {
                this.logInfo('[HTTP] GET /api/room-code/check | greška: nedostaje query parametar code');
                return sendJson(res, 400, {
                    valid: false,
                    available: false,
                    error: 'missing_code',
                    message: 'Query parameter code is required',
                });
            }
            if (!this.isValidCode(code)) {
                this.logInfo(`[HTTP] GET /api/room-code/check | pin=${code} | nevaljan format (mora biti 16 znakova)`);
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
            this.logInfo(`[HTTP] GET /api/room-code/check | pin=${code} | occupied=${details.occupied} | RAM=${details.inMemorySession} | DB=${details.inDatabase} | rezervacija=${details.reserved}`);
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
            this.logError('GET /api/room-code/check failed', err);
            return sendJson(res, 500, { error: 'internal_error' });
        }
    }
}

module.exports = { RoomCodeCheckGetRoute };
