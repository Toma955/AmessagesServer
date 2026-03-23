/**
 * Metapodaci priključka s gledišta TCP / upgrade zahtjeva.
 * Ne koriste se za filtriranje — samo evidencija u RAM-u (isti PIN = ista soba).
 */

/**
 * @param {import('ws')} ws
 * @returns {{ remoteAddress: string | null, remotePort: number | null, forwardedFor: string | null }}
 */
function getWsTransportMeta(ws) {
    const sock = ws && ws._socket;
    const req = ws && ws._httpUpgradeReq;
    const raw = req && req.headers && req.headers['x-forwarded-for'];
    let forwardedFor = null;
    if (typeof raw === 'string' && raw.trim()) {
        forwardedFor = raw.split(',')[0].trim();
    }
    return {
        remoteAddress: sock && sock.remoteAddress != null ? String(sock.remoteAddress) : null,
        remotePort: typeof sock?.remotePort === 'number' ? sock.remotePort : null,
        forwardedFor,
    };
}

module.exports = { getWsTransportMeta };
