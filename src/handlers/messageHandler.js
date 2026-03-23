const { isValidCode } = require('../utils/validateCode');
const { broadcastToRoom, getSessionForClientInRoom, wakeSessionByCode } = require('../core/roomManager');
const { pushRoomEvent } = require('../core/roomDiagnostics');
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
    pushRoomEvent(code, 'traffic', 'msg: relay poruke preko servera (sadržaj je E2E šifriran na klijentu).');
    // ciphertext je već enkriptiran na klijentu (E2E); ovaj kanal je dodatno box prema serveru
    broadcastToRoom(code, ws, msg);
}

module.exports = { handleMessage };
