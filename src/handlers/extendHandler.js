const { extendSession } = require('../core/roomManager');
const { isValidCode } = require('../utils/validateCode');

function handleExtendResponse(ws, msg) {
    const code = msg.code;
    const accept = msg.accept;

    if (!isValidCode(code)) return;

    if (accept) {
        extendSession(ws, code);
    } else {
        ws.send(JSON.stringify({
            t: 'extend_declined',
            code,
        }));
    }
}

module.exports = { handleExtendResponse };
