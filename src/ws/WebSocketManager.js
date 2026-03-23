const WebSocket = require('ws');
const { logInfo, logError } = require('../utils/logger');

/**
 * Veže WebSocket poslužitelj na HTTP server i upravlja životnim ciklusom veza.
 */
class WebSocketManager {
    /**
     * @param {object} options
     * @param {import('http').Server} options.httpServer
     * @param {(ws: import('ws'), raw: string) => void} options.routeMessage
     * @param {(ws: import('ws')) => void} options.leaveRoom
     * @param {(ws: import('ws')) => string | null} options.getRoomCodeForWs
     */
    constructor({ httpServer, routeMessage, leaveRoom, getRoomCodeForWs }) {
        this.httpServer = httpServer;
        this.routeMessage = routeMessage;
        this.leaveRoom = leaveRoom;
        this.getRoomCodeForWs = getRoomCodeForWs;
        this._seq = 0;
        /** @type {import('ws').Server | null} */
        this.wss = null;
    }

    /** @returns {import('ws').Server} */
    attach() {
        this.wss = new WebSocket.Server({ server: this.httpServer });
        this.wss.on('connection', (ws, req) => this._onConnection(ws, req));
        return this.wss;
    }

    /**
     * @param {import('ws')} ws
     * @param {import('http').IncomingMessage} req
     */
    _onConnection(ws, req) {
        ws._httpUpgradeReq = req;
        ws._clientId = ++this._seq;
        logInfo(`[WS] OPEN | id=ws${ws._clientId} | nova TCP/WebSocket veza`);

        ws.on('message', (data) => {
            this.routeMessage(ws, data.toString());
        });

        ws.on('close', () => {
            const pin = this.getRoomCodeForWs(ws);
            if (pin) {
                logInfo(`[WS] CLOSE | id=ws${ws._clientId} | bio_u_sobi_pin=${pin} (slijedi leaveRoom)`);
            } else {
                logInfo(`[WS] CLOSE | id=ws${ws._clientId} | nije bio u sobi (nema join)`);
            }
            this.leaveRoom(ws);
        });

        ws.on('error', (err) => {
            logError(`[WS] error | id=ws${ws._clientId}`, err);
        });
    }
}

module.exports = { WebSocketManager };
