function ts() {
    return new Date().toISOString();
}

function logInfo(...args) {
    console.log(`[${ts()}] [INFO]`, ...args);
}

function logError(...args) {
    console.error(`[${ts()}] [ERROR]`, ...args);
}

module.exports = { logInfo, logError };
