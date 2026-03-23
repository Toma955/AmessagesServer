const { isValidCode } = require('../utils/validateCode');
const { broadcastToRoom, getSessionForClientInRoom, wakeSessionByCode } = require('../core/roomManager');
const { sendSecure } = require('../crypto/boxChannel');

function handleMessage(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const session = getSessionForClientInRoom(ws, code);
    if (!session) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'not_in_room',
            message: 'You are not in this room',
        });
    }

    wakeSessionByCode(code);
    // ciphertext je već enkriptiran na klijentu (E2E); ovaj kanal je dodatno box prema serveru
    broadcastToRoom(code, ws, msg);
}

module.exports = { handleMessage };
