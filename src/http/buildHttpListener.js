const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/logger');
const { isValidCode } = require('../utils/validateCode');
const {
    listActiveRooms,
    allocateUniqueRoomCode,
    getRoomCodeAvailabilityDetails,
} = require('../core/roomManager');
const { listAllSessionsFromDb } = require('../db/sessionStore');
const { HttpPipeline } = require('./HttpPipeline');
const { HealthRoute } = require('./routes/HealthRoute');
const { RoomCodeCheckGetRoute } = require('./routes/RoomCodeCheckGetRoute');
const { RoomCodeCheckPostRoute } = require('./routes/RoomCodeCheckPostRoute');
const { RoomCodeAllocateRoute } = require('./routes/RoomCodeAllocateRoute');
const { RoomsListRoute } = require('./routes/RoomsListRoute');
const { IndexHtmlRoute } = require('./routes/IndexHtmlRoute');
const { logInfo } = require('../utils/logger');

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

    const shared = {
        isValidCode,
        getRoomCodeAvailabilityDetails,
        allocateUniqueRoomCode,
        listActiveRooms,
        listAllSessionsFromDb,
        logInfo: li,
        logError: le,
    };

    const routes = [
        new HealthRoute(),
        new RoomCodeCheckGetRoute(shared),
        new RoomCodeCheckPostRoute(shared),
        new RoomCodeAllocateRoute(shared),
        new RoomsListRoute(shared),
        new IndexHtmlRoute({ indexHtml }),
    ];

    return new HttpPipeline(routes).createListener();
}

module.exports = { buildHttpListener, loadIndexHtml };
