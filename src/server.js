const http = require('http');
const sodium = require('libsodium-wrappers');
const { getConfig } = require('./config/env');
const { initServerIdentity } = require('./crypto/serverIdentity');
const { initSessionDb, closeSessionDb } = require('./db/sessionStore');
const { routeMessage } = require('./core/messageRouter');
const {
    leaveRoom,
    syncAllSessionsToDatabase,
    getRoomCodeForWs,
} = require('./core/roomManager');
const { logInfo, logError } = require('./utils/logger');
const { buildHttpListener } = require('./http/buildHttpListener');
const { WebSocketManager } = require('./ws/WebSocketManager');
const { shutdownGracefully } = require('./bootstrap/shutdown');

const config = getConfig();

const server = http.createServer(buildHttpListener());

const wsManager = new WebSocketManager({
    httpServer: server,
    routeMessage,
    leaveRoom,
    getRoomCodeForWs,
});
const wss = wsManager.attach();

const listeningPromise = (async () => {
    await sodium.ready;
    await initServerIdentity();
    initSessionDb();
    await new Promise((resolve, reject) => {
        server.listen(config.PORT, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    logInfo(`Server listening on port ${config.PORT}`);

    if (config.NODE_ENV !== 'test' && config.SYNC_DB_INTERVAL_MS > 0) {
        const id = setInterval(() => {
            try {
                syncAllSessionsToDatabase();
            } catch (err) {
                logError('periodic sync failed', err);
            }
        }, config.SYNC_DB_INTERVAL_MS);
        id.unref();
    }

    if (config.NODE_ENV !== 'test') {
        process.on('SIGINT', () => shutdownGracefully({
            wss,
            server,
            syncAllSessionsToDatabase,
            closeSessionDb,
        }, 'SIGINT'));
        process.on('SIGTERM', () => shutdownGracefully({
            wss,
            server,
            syncAllSessionsToDatabase,
            closeSessionDb,
        }, 'SIGTERM'));
    }
})().catch((err) => {
    logError('Server failed to start', err);
    process.exit(1);
});

module.exports = { server, wss, listeningPromise };
