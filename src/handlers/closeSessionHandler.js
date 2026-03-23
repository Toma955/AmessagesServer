const { closeSessionByClient } = require('../core/roomManager');
const { isValidCode } = require('../utils/validateCode');
const { logInfo } = require('../utils/logger');
const { sendSecure } = require('../crypto/boxChannel');

function handleCloseSession(ws, msg) {
    const code = msg.code;

    logInfo(`[close_session] zahtjev | pin=${code}`);

    if (!isValidCode(code)) {
        logInfo(`[close_session] odbijen nevaljan PIN | pin=${code}`);
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const result = closeSessionByClient(ws, code);
    if (!result.ok) {
        logInfo(`[close_session] odbijen | pin=${code} | reason=${result.reason}`);
        return sendSecure(ws, {
            t: 'error',
            reason: result.reason,
            message: result.reason === 'not_in_room'
                ? 'You are not in this room'
                : 'Session not found',
        });
    }
}

module.exports = { handleCloseSession };
