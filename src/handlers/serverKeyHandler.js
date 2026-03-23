const { getServerPublicKeyBase64 } = require('../crypto/serverIdentity');

function handleGetServerKey(ws) {
    ws.send(JSON.stringify({
        t: 'server_key',
        publicKey: getServerPublicKeyBase64(),
    }));
}

module.exports = { handleGetServerKey };
