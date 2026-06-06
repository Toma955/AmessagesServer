const crypto = require('crypto');
const { sendJson, readRequestBody } = require('../httpUtils');
const { getServerPublicKeyBase64 } = require('../../crypto/serverIdentity');

/**
 * GET /api/security/policy — S1
 * GET /api/security/server-key — S2
 * POST /api/security/client-capabilities — S3
 */
class SecurityRoutes {
    constructor({ logError }) {
        this.logError = logError;
    }

    canHandle(req, pathname) {
        if (pathname === '/api/security/policy' && req.method === 'GET') return true;
        if (pathname === '/api/security/server-key' && req.method === 'GET') return true;
        if (pathname === '/api/security/client-capabilities' && req.method === 'POST') return true;
        return false;
    }

    handle(req, res) {
        const pathname = new URL(req.url, 'http://localhost').pathname;

        if (pathname === '/api/security/policy' && req.method === 'GET') {
            return sendJson(res, 200, {
                minTlsVersion: '1.2',
                requiredBoxVersion: 'box-v1',
                transportEncRequired: true,
                pinMinLength: 4,
                pinMaxLength: 12,
                recommendedPinLock: true,
                biometricAllowed: true,
                sessionMaxIdleSec: 300,
            });
        }

        if (pathname === '/api/security/server-key' && req.method === 'GET') {
            try {
                const publicKeyBase64 = getServerPublicKeyBase64();
                const fingerprintSha256 = crypto
                    .createHash('sha256')
                    .update(Buffer.from(publicKeyBase64, 'base64'))
                    .digest('hex');
                return sendJson(res, 200, {
                    algorithm: 'curve25519',
                    publicKeyBase64,
                    fingerprintSha256,
                    rotatedAt: new Date().toISOString(),
                });
            } catch (err) {
                this.logError('GET /api/security/server-key failed', err);
                return sendJson(res, 503, { error: 'identity_not_ready' });
            }
        }

        if (pathname === '/api/security/client-capabilities' && req.method === 'POST') {
            readRequestBody(req)
                .then((body) => {
                    try {
                        if (body) JSON.parse(body);
                    } catch {
                        return sendJson(res, 400, { error: 'invalid_json' });
                    }
                    return sendJson(res, 200, {
                        allowed: true,
                        warnings: [],
                        requiredActions: [],
                    });
                })
                .catch((err) => {
                    this.logError('POST /api/security/client-capabilities failed', err);
                    sendJson(res, 500, { error: 'internal_error' });
                });
            return undefined;
        }

        sendJson(res, 404, { error: 'not_found' });
        return undefined;
    }
}

module.exports = { SecurityRoutes };
