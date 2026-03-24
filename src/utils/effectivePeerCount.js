/**
 * Broj logičkih peera u direct sobi: dva WebSocketa ili INSIDE (isti WS, drugi join istim PIN-om).
 */
function effectivePeerCount(session) {
    if (!session) return 0;
    if (session.type !== 'direct') return session.clients.size;
    if (session.clients.size >= 2) return session.clients.size;
    if (session.clients.size === 1 && session.insideProtocol) return 2;
    return session.clients.size;
}

module.exports = { effectivePeerCount };
