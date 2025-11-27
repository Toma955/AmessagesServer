function isValidCode(code) {

    return typeof code === 'string' && /^[\x20-\x7E]{16}$/.test(code);
}

module.exports = { isValidCode };
