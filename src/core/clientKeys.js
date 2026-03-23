/** Javni ključ klijenta (Uint8Array, crypto_box) po WebSocket vezi. */
const clientPublicKeys = new WeakMap();

function setClientPublicKey(ws, publicKeyBytes) {
    clientPublicKeys.set(ws, publicKeyBytes);
}

function hasClientKey(ws) {
    return clientPublicKeys.has(ws);
}

function getClientPublicKeyBytes(ws) {
    return clientPublicKeys.get(ws);
}

module.exports = {
    setClientPublicKey,
    hasClientKey,
    getClientPublicKeyBytes,
};
