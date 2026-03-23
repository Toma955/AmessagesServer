const sodium = require('libsodium-wrappers');

let keypair = null;

async function initServerIdentity() {
    await sodium.ready;
    keypair = sodium.crypto_box_keypair();
}

function assertReady() {
    if (!keypair) {
        throw new Error('Server identity not initialized');
    }
}

function getServerPublicKeyBase64() {
    assertReady();
    return Buffer.from(keypair.publicKey).toString('base64');
}

function getSodium() {
    assertReady();
    return sodium;
}

/** Za crypto_box (interno, ne šalji klijentu). */
function getServerKeypairBytes() {
    assertReady();
    return {
        publicKey: keypair.publicKey,
        privateKey: keypair.privateKey,
    };
}

module.exports = {
    initServerIdentity,
    getServerPublicKeyBase64,
    getSodium,
    getServerKeypairBytes,
};
