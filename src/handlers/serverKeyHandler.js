const { getServerPublicKeyBase64 } = require('../crypto/serverIdentity');
const { logInfo } = require('../utils/logger');

function handleGetServerKey(ws) {
    logInfo(`[WS] plaintext | get_server_key | id=ws${ws._clientId ?? '?'}`);
    ws.send(JSON.stringify({
        t: 'server_key',
        publicKey: getServerPublicKeyBase64(),
    }));
}

module.exports = { handleGetServerKey };
