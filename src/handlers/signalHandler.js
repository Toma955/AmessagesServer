const { isValidCode } = require('../utils/validateCode');
const { broadcastToRoom } = require('../core/roomManager');

function handleSignal(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) return;

    const payload = JSON.stringify(msg);
    broadcastToRoom(code, ws, payload);
}

module.exports = { handleSignal };
