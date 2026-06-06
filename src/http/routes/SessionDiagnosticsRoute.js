const { sendJson, readRequestBody } = require('../httpUtils');

/**
 * POST /api/sessions/diagnostics — W6
 */
class SessionDiagnosticsRoute {
    constructor({ logInfo, logError }) {
        this.logInfo = logInfo;
        this.logError = logError;
    }

    canHandle(req, pathname) {
        return req.method === 'POST' && pathname === '/api/sessions/diagnostics';
    }

    async handle(req, res) {
        readRequestBody(req)
            .then((raw) => {
                let body = {};
                if (raw) {
                    try {
                        body = JSON.parse(raw);
                    } catch {
                        return sendJson(res, 400, { error: 'invalid_json' });
                    }
                }
                this.logInfo('[diagnostics]', JSON.stringify({
                    phase: body.phase || 'unknown',
                    reason: body.reason || null,
                    clientVersion: body.clientVersion || null,
                }));
                return sendJson(res, 202, { accepted: true });
            })
            .catch((err) => {
                this.logError('POST /api/sessions/diagnostics failed', err);
                sendJson(res, 500, { error: 'internal_error' });
            });
    }
}

module.exports = { SessionDiagnosticsRoute };
