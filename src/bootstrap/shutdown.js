const { logInfo, logError } = require('../utils/logger');

/**
 * SIGINT/SIGTERM: sinkroniziraj bazu, zatvori WS i HTTP, zatvori SQLite.
 * @param {object} options
 * @param {import('ws').Server | null} options.wss
 * @param {import('http').Server} options.server
 * @param {() => void} options.syncAllSessionsToDatabase
 * @param {() => void} options.closeSessionDb
 * @param {string} [signal]
 */
function shutdownGracefully({ wss, server, syncAllSessionsToDatabase, closeSessionDb }, signal) {
    logInfo('Shutting down', signal || '');
    try {
        syncAllSessionsToDatabase();
    } catch (err) {
        logError('syncAllSessionsToDatabase on shutdown failed', err);
    }

    if (wss) {
        wss.close(() => {
            server.close((closeErr) => {
                if (closeErr) logError('server.close', closeErr);
                closeSessionDb();
                process.exit(closeErr ? 1 : 0);
            });
        });
    } else {
        server.close((closeErr) => {
            if (closeErr) logError('server.close', closeErr);
            closeSessionDb();
            process.exit(closeErr ? 1 : 0);
        });
    }

    setTimeout(() => {
        logError('Shutdown timeout, forcing exit');
        closeSessionDb();
        process.exit(1);
    }, 10000).unref();
}

module.exports = { shutdownGracefully };
