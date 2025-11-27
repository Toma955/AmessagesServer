function ts() {
    return new Date().toISOString();
}

const isTest = process.env.NODE_ENV === 'test';

function logInfo(...args) {
    if (isTest) return;
    console.log(`[${ts()}] [INFO]`, ...args);
}

function logError(...args) {
    if (isTest) return;
    console.error(`[${ts()}] [ERROR]`, ...args);
}

module.exports = { logInfo, logError };
