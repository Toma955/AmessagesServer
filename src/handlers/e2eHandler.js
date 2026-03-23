const { isValidCode } = require('../utils/validateCode');
const { getSessionForClientInRoom } = require('../core/roomManager');
const { pushRoomEvent } = require('../core/roomDiagnostics');
const { persistSession } = require('../db/sessionStore');
const { sendSecure } = require('../crypto/boxChannel');
const { logInfo } = require('../utils/logger');

/**
 * Oba klijenta u direct sobi javljaju da su prešli na izravni E2E kanal —
 * soba ulazi u hibernaciju (manje upisa u SQLite) dok netko ne pošalje signal/msg/ping.
 */
function handleE2eReady(ws, msg) {
    const code = msg.code;

    if (!isValidCode(code)) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'invalid_code',
            message: 'Code must be 16 ASCII characters',
        });
    }

    const session = getSessionForClientInRoom(ws, code);
    if (!session) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'not_in_room',
            message: 'You are not in this room',
        });
    }

    if (session.type !== 'direct' || session.clients.size !== 2) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'e2e_ready_invalid',
            message: 'E2E standby is only for a connected direct room with two peers',
        });
    }

    session.e2eReadyFrom.add(ws);
    logInfo(`[e2e_ready] pin=${code} | spremnih_klijenata=${session.e2eReadyFrom.size}/2`);

    if (session.e2eReadyFrom.size >= 2) {
        persistSession(session, true);
        session.hibernated = true;
        logInfo(`[e2e_ready] HIBERNACIJA UKLJUČENA | pin=${code} | oba klijenta na E2E standby`);
        pushRoomEvent(code, 'system', 'e2e_ready: oba klijenta na izravnom E2E kanalu — soba u hibernaciji (manje DB upisa).');
        for (const client of session.clients) {
            if (client.readyState === client.OPEN) {
                sendSecure(client, {
                    t: 'e2e_ready_ack',
                    code,
                    hibernated: true,
                });
            }
        }
    } else {
        pushRoomEvent(code, 'system', 'e2e_ready: jedan klijent spreman — čeka se drugi peer.');
        sendSecure(ws, {
            t: 'e2e_ready_ack',
            code,
            hibernated: false,
            pendingPeer: true,
        });
    }
}

module.exports = { handleE2eReady };
