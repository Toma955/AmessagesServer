const { joinRoom } = require('../core/roomManager');
const { isValidCode } = require('../utils/validateCode');

function handleJoin(ws, msg) {
    const code = msg.code;
    const mode = msg.mode || 'direct';

    if (!isValidCode(code)) {
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        }));
    }

    joinRoom(ws, code, mode);
}

module.exports = { handleJoin };
