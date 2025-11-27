const { isValidCode } = require('../utils/validateCode');
const { broadcastToRoom } = require('../core/roomManager');

function handleMessage(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) return;

    // ciphertext je već enkriptiran na klijentu
    const payload = JSON.stringify(msg);
    broadcastToRoom(code, ws, payload);
}

module.exports = { handleMessage };
