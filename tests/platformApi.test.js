const http = require('http');

if (!process.env.PORT) {
    process.env.PORT = '0';
}

const { server, listeningPromise } = require('../src/server');

function testPort() {
    const addr = server.address();
    return typeof addr === 'object' && addr && addr.port != null ? addr.port : 3000;
}

function httpGet(path) {
    return new Promise((resolve, reject) => {
        const port = testPort();
        http.get(`http://127.0.0.1:${port}${path}`, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    body: Buffer.concat(chunks).toString('utf8'),
                });
            });
        }).on('error', reject);
    });
}

describe('Nilternius platform API', () => {
    beforeAll(async () => {
        await listeningPromise;
    });

    test('GET /ping', async () => {
        const res = await httpGet('/ping');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).status).toBe('ok');
    });

    test('GET /api/server/info', async () => {
        const res = await httpGet('/api/server/info');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.service).toBe('amessages-server');
        expect(Array.isArray(body.protocols)).toBe(true);
    });

    test('GET /api/network/ping', async () => {
        const res = await httpGet('/api/network/ping');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).ok).toBe(true);
    });

    test('GET /api/market/ping', async () => {
        const res = await httpGet('/api/market/ping');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).ok).toBe(true);
    });

    test('GET /api/market/catalog?category=applications', async () => {
        const res = await httpGet('/api/market/catalog?category=applications');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.category).toBe('applications');
        expect(body.items.length).toBeGreaterThanOrEqual(2);
        expect(body.items[0].idNumber).toBeDefined();
    });

    test('GET /api/market/items/by-id-number/10001', async () => {
        const res = await httpGet('/api/market/items/by-id-number/10001');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.id).toBe('sah');
    });

    test('GET /api/market/id-number/validate?number=10001', async () => {
        const res = await httpGet('/api/market/id-number/validate?number=10001');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.valid).toBe(true);
        expect(body.exists).toBe(true);
    });

    test('GET /api/security/policy', async () => {
        const res = await httpGet('/api/security/policy');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).pinMinLength).toBe(4);
    });

    test('GET /api/market/items/sah/packages/1.0.0 downloads package', async () => {
        const res = await httpGet('/api/market/items/sah/packages/1.0.0');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.format).toBe('nilternius-package-v1');
        expect(body.manifest.itemId).toBe('sah');
    });

    test('GET /api/market/items/sah/versions/1.0.0/manifest includes downloadUrl', async () => {
        const res = await httpGet('/api/market/items/sah/versions/1.0.0/manifest');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.downloadUrl).toContain('/api/market/items/sah/packages/1.0.0');
        expect(body.sha256).toHaveLength(64);
    });

    test('GET /api/app/system-comms returns announcements and updates', async () => {
        const res = await httpGet('/api/app/system-comms?appVersion=1.0.0&platform=ios&locale=hr');
        expect(res.status).toBe(200);
        const body = JSON.parse(res.body);
        expect(body.hostApp).toBeDefined();
        expect(Array.isArray(body.notifications)).toBe(true);
        expect(Array.isArray(body.updates)).toBe(true);
        expect(body.featureFlags.systemCommsEnabled).toBe(true);
    });

    test('GET /api/watchman/config', async () => {
        const res = await httpGet('/api/watchman/config');
        expect(res.status).toBe(200);
        expect(JSON.parse(res.body).insideEnabled).toBe(true);
    });
});
