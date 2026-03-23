const crypto = require('crypto');

/** Znakovi u rasponu isprintable ASCII (validno za isValidCode), bez razmaka i bez " \ za lakše kopiranje u JSON. */
const CODE_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*-_=+[]{}|;:,.?/~`';

function randomRoomCode16() {
    let s = '';
    for (let i = 0; i < 16; i += 1) {
        s += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
    }
    return s;
}

module.exports = {
    randomRoomCode16,
    CODE_ALPHABET,
};
