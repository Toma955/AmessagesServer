const { extendSession } = require('../core/roomManager');
const { isValidCode } = require('../utils/validateCode');
const { logInfo } = require('../utils/logger');

function handleExtendResponse(ws, msg) {
    const code = msg.code;
    const accept = !!msg.accept;

    logInfo('EXTEND_RESPONSE received', 'code:', code, 'accept:', accept);

    if (!isValidCode(code)) {
        logInfo('EXTEND_RESPONSE invalid code', code);
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        }));
    }

    if (accept) {
        logInfo('EXTEND accepted by client for code', code);
        extendSession(ws, code);   // ovdje se radi stvarno produženje
    } else {
        logInfo('EXTEND declined by client for code', code);
        ws.send(JSON.stringify({
            t: 'extend_declined',
            code,
        }));
    }
}

module.exports = { handleExtendResponse };
