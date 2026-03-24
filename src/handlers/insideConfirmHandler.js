const { isValidCode } = require('../utils/validateCode');
const { getSessionForClientInRoom } = require('../core/roomManager');
const { pushRoomEvent } = require('../core/roomDiagnostics');
const { sendSecure } = require('../crypto/boxChannel');
const { persistSession } = require('../db/sessionStore');
const { logInfo } = require('../utils/logger');

/**
 * Odgovor na serverski upit: ovo je INSIDE razgovor (isti uređaj / isti chat).
 * Opcionalno `message` — kratka sistemska napomena za log.
 */
function handleInsideConfirm(ws, msg) {
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

    if (!session.insideProtocol) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'inside_confirm_invalid',
            message: 'inside_confirm only after second join with same PIN on same WebSocket (INSIDE)',
        });
    }

    session.insideConfirmed = true;
    persistSession(session, true);
    const note = typeof msg.message === 'string' ? msg.message.slice(0, 512) : '';
    logInfo(`[inside_confirm] pin=${code} | note=${note ? 'yes' : 'no'}`);
    pushRoomEvent(code, 'system', `inside_confirm: INSIDE potvrđen${note ? ` (${note})` : ''}.`);

    sendSecure(ws, {
        t: 'inside_confirm_ack',
        code,
        insideConfirmed: true,
    });

    for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
            sendSecure(client, {
                t: 'inside_confirmed',
                code,
                message: note || undefined,
            });
        }
    }
}

/**
 * Klijent prelazi u hibridni mod (npr. dodatni LAN / ARP kanal uz server relay).
 */
function handleInsideHybrid(ws, msg) {
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

    if (!session.insideProtocol) {
        return sendSecure(ws, {
            t: 'error',
            reason: 'inside_hybrid_invalid',
            message: 'inside_hybrid only applies to INSIDE sessions',
        });
    }

    session.insideHybridMode = true;
    persistSession(session, true);
    logInfo(`[inside_hybrid] pin=${code}`);
    pushRoomEvent(code, 'system', 'inside_hybrid: hibridni mod (klijent).');

    for (const client of session.clients) {
        if (client.readyState === client.OPEN) {
            sendSecure(client, {
                t: 'inside_hybrid_ack',
                code,
                hybrid: true,
            });
        }
    }
}

module.exports = { handleInsideConfirm, handleInsideHybrid };
