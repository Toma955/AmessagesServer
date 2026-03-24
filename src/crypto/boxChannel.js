const { getSodium, getServerKeypairBytes } = require('./serverIdentity');
const { getClientPublicKeyBytes } = require('../core/clientKeys');
const { logError, logInfo } = require('../utils/logger');

/** Maks. veličina ciphertexta (zaštita od DoS). */
const MAX_CIPHER_BYTES = 512 * 1024;

/**
 * Klijent → server: otvori box (pošiljatelj klijent, primatelj server).
 */
function decryptFromClient(ws, nonceB64, cipherB64) {
    const sodium = getSodium();
    const clientPk = getClientPublicKeyBytes(ws);
    if (!clientPk) {
        throw new Error('no_client_key');
    }
    const { privateKey: serverSk } = getServerKeypairBytes();

    const nonce = Buffer.from(nonceB64, 'base64');
    const cipher = Buffer.from(cipherB64, 'base64');

    if (cipher.length > MAX_CIPHER_BYTES) {
        throw new Error('ciphertext_too_large');
    }
    if (nonce.length !== sodium.crypto_box_NONCEBYTES) {
        throw new Error('bad_nonce');
    }

    const plain = sodium.crypto_box_open_easy(cipher, nonce, clientPk, serverSk);
    const text = Buffer.from(plain).toString('utf8');
    return JSON.parse(text);
}

/**
 * Server → klijent: šalje unutarnji JSON u crypto_box (primatelj klijent).
 */
function sendSecure(ws, innerObj) {
    const sodium = getSodium();
    const clientPk = getClientPublicKeyBytes(ws);
    if (!clientPk) {
        throw new Error('sendSecure: client public key missing');
    }
    const { privateKey: serverSk } = getServerKeypairBytes();

    const plain = Buffer.from(JSON.stringify(innerObj), 'utf8');
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const cipher = sodium.crypto_box_easy(plain, nonce, clientPk, serverSk);

    const innerT = innerObj && typeof innerObj.t === 'string' ? innerObj.t : '?';
    logInfo(`[WS] box out | inner.t=${innerT} | c_len=${cipher.length}`);

    ws.send(JSON.stringify({
        t: 'box',
        nonce: Buffer.from(nonce).toString('base64'),
        c: Buffer.from(cipher).toString('base64'),
    }));
}

function trySendSecure(ws, innerObj) {
    try {
        sendSecure(ws, innerObj);
    } catch (err) {
        logError('sendSecure failed', err);
    }
}

module.exports = {
    decryptFromClient,
    sendSecure,
    trySendSecure,
    MAX_CIPHER_BYTES,
};
