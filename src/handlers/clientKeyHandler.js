const { getSodium } = require('../crypto/serverIdentity');
const { setClientPublicKey } = require('../core/clientKeys');
const { logInfo } = require('../utils/logger');

function handleClientKey(ws, msg) {
    const sodium = getSodium();
    const expectedLen = sodium.crypto_box_PUBLICKEYBYTES;

    if (typeof msg.publicKey !== 'string') {
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'invalid_client_key',
            message: 'publicKey must be a base64 string',
        }));
    }

    let bytes;
    try {
        bytes = Buffer.from(msg.publicKey, 'base64');
    } catch {
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'invalid_client_key',
            message: 'publicKey is not valid base64',
        }));
    }

    if (bytes.length !== expectedLen) {
        return ws.send(JSON.stringify({
            t: 'error',
            reason: 'invalid_client_key',
            message: `publicKey must decode to ${expectedLen} bytes`,
        }));
    }

    const pub = new Uint8Array(bytes);
    setClientPublicKey(ws, pub);
    logInfo('Client public key registered');

    ws.send(JSON.stringify({ t: 'client_key_ack', ok: true }));
}

module.exports = { handleClientKey };
