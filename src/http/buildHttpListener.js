const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/logger');
const { isValidCode } = require('../utils/validateCode');
const {
    listActiveRooms,
    allocateUniqueRoomCode,
    getRoomCodeAvailabilityDetails,
    validateRoomCodeForJoin,
    getRoomPublicStatus,
} = require('../core/roomManager');
const { listAllSessionsFromDb } = require('../db/sessionStore');
const { HttpPipeline } = require('./HttpPipeline');
const { HealthRoute } = require('./routes/HealthRoute');
const { PingStatusRoutes } = require('./routes/PingStatusRoutes');
const { ServerInfoRoute } = require('./routes/ServerInfoRoute');
const { RoomCodeCheckGetRoute } = require('./routes/RoomCodeCheckGetRoute');
const { RoomCodeCheckPostRoute } = require('./routes/RoomCodeCheckPostRoute');
const { RoomCodeValidateRoute } = require('./routes/RoomCodeValidateRoute');
const { RoomCodeAllocateRoute } = require('./routes/RoomCodeAllocateRoute');
const { RoomStatusRoute } = require('./routes/RoomStatusRoute');
const { RoomsListRoute } = require('./routes/RoomsListRoute');
const { WatchmanConfigRoute } = require('./routes/WatchmanConfigRoute');
const { SessionDiagnosticsRoute } = require('./routes/SessionDiagnosticsRoute');
const { NetworkRoutes } = require('./routes/NetworkRoutes');
const { SecurityRoutes } = require('./routes/SecurityRoutes');
const { MarketRoutes } = require('./routes/MarketRoutes');
const { AppSystemCommsRoute } = require('./routes/AppSystemCommsRoute');
const { IndexHtmlRoute } = require('./routes/IndexHtmlRoute');
const { RoomAdminApiRoute } = require('./routes/RoomAdminApiRoute');
const { logInfo } = require('../utils/logger');
const { getConfig } = require('../config/env');

function loadIndexHtml() {
    const indexHtmlPath = path.join(__dirname, '..', '..', 'public', 'index.html');
    try {
        return fs.readFileSync(indexHtmlPath, 'utf8');
    } catch (err) {
        logError('Could not read public/index.html', err);
        return null;
    }
}

/**
 * Sastavlja HTTP request listener iz pojedinačnih ruta.
 * @param {{ indexHtml?: string | null, logInfo?: typeof logInfo, logError?: typeof logError }} [options]
 */
function buildHttpListener(options = {}) {
    const indexHtml = options.indexHtml !== undefined ? options.indexHtml : loadIndexHtml();
    const li = options.logInfo || logInfo;
    const le = options.logError || logError;
    const cfg = options.config || getConfig();

    const shared = {
        isValidCode,
        getRoomCodeAvailabilityDetails,
        allocateUniqueRoomCode,
        listActiveRooms,
        listAllSessionsFromDb,
        validateRoomCodeForJoin,
        getRoomPublicStatus,
        logInfo: li,
        logError: le,
    };

    const adminRoute = new RoomAdminApiRoute({
        isValidCode,
        getAdminToken: () => cfg.ADMIN_TOKEN,
        logInfo: li,
        logError: le,
    });

    const routes = [
        new HealthRoute(),
        new PingStatusRoutes(),
        new ServerInfoRoute(),
        new NetworkRoutes(),
        new SecurityRoutes({ logError: le }),
        new MarketRoutes(),
        new AppSystemCommsRoute(),
        new WatchmanConfigRoute(),
        new SessionDiagnosticsRoute({ logInfo: li, logError: le }),
        new RoomCodeCheckGetRoute(shared),
        new RoomCodeCheckPostRoute(shared),
        new RoomCodeValidateRoute(shared),
        new RoomCodeAllocateRoute(shared),
        new RoomStatusRoute(shared),
        new RoomsListRoute(shared),
        adminRoute,
        new IndexHtmlRoute({ indexHtml }),
    ];

    return new HttpPipeline(routes).createListener();
}

module.exports = { buildHttpListener, loadIndexHtml };
