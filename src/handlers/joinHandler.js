const { joinRoom } = require('../core/roomManager');
const { isValidCode } = require('../utils/validateCode');
const { logInfo } = require('../utils/logger');
const { sendSecure } = require('../crypto/boxChannel');

function handleJoin(ws, msg) {
    const code = msg.code;
    const mode = msg.mode || 'direct';

    logInfo(`[join] zahtjev (handleJoin) | pin=${code} | mode=${mode}`);

    if (!isValidCode(code)) {
        logInfo(`[join] odbijen nevaljan PIN | pin=${code}`);
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    joinRoom(ws, code, mode);
}

module.exports = { handleJoin };
