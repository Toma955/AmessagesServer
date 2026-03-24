const http = require('http');
const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');

/** Slušaj na slobodnom portu (0) da testovi ne padnu ako je 3000 zauzet lokalno. */
if (!process.env.PORT) {
    process.env.PORT = '0';
}

const { server, listeningPromise } = require('../src/server');

function testPort() {
    const addr = server.address();
    return typeof addr === 'object' && addr && addr.port != null ? addr.port : 3000;
}

let WS_URL = 'ws://localhost:3000';
let HTTP_BASE = 'http://127.0.0.1:3000';

jest.setTimeout(20000);

function waitForType(ws, expectedType, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout čekajući poruku tipa ${expectedType}`));
        }, timeoutMs);

        const handler = (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (msg.t === expectedType) {
                clearTimeout(timeout);
                ws.off('message', handler);
                resolve(msg);
            }
        };

        ws.on('message', handler);
    });
}

function encryptClientToServer(innerObj, serverPk, clientSk) {
    const plain = Buffer.from(JSON.stringify(innerObj), 'utf8');
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const cipher = sodium.crypto_box_easy(plain, nonce, serverPk, clientSk);
    return JSON.stringify({
        t: 'box',
        nonce: Buffer.from(nonce).toString('base64'),
        c: Buffer.from(cipher).toString('base64'),
    });
}

/** Server → klijent (box). */
function decryptServerToClient(boxMsg, serverPk, clientSk) {
    const nonce = Buffer.from(boxMsg.nonce, 'base64');
    const cipher = Buffer.from(boxMsg.c, 'base64');
    const plain = sodium.crypto_box_open_easy(cipher, nonce, serverPk, clientSk);
    return JSON.parse(Buffer.from(plain).toString('utf8'));
}

function waitForInnerType(ws, expectedInnerT, { serverPk, clientSk }, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error(`Timeout čekajući inner t=${expectedInnerT}`));
        }, timeoutMs);

        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t !== 'box') return;
                const inner = decryptServerToClient(msg, serverPk, clientSk);
                if (inner.t === expectedInnerT) {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    resolve(inner);
                }
            } catch {
                /* ignore */
            }
        };

        ws.on('message', handler);
    });
}

/** Prvi box odgovor s inner.t === 'error' (npr. not_in_room). */
function waitForInnerError(ws, { serverPk, clientSk }, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('Timeout čekajući inner t=error'));
        }, timeoutMs);

        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t !== 'box') return;
                const inner = decryptServerToClient(msg, serverPk, clientSk);
                if (inner.t === 'error') {
                    clearTimeout(timeout);
                    ws.off('message', handler);
                    resolve(inner);
                }
            } catch {
                /* ignore */
            }
        };

        ws.on('message', handler);
    });
}

function httpRequestJson(options, bodyStr) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(buf || '{}') });
                } catch (e) {
                    reject(e);
                }
            });
        });
        req.on('error', reject);
        if (bodyStr != null) {
            req.write(bodyStr);
        }
        req.end();
    });
}

beforeAll(async () => {
    await sodium.ready;
    await listeningPromise;
    const p = testPort();
    WS_URL = `ws://localhost:${p}`;
    HTTP_BASE = `http://127.0.0.1:${p}`;
});

afterAll((done) => {
    if (server && server.close) {
        server.close(() => done());
    } else {
        done();
    }
});

async function exchangeKeys(ws) {
    const kp = sodium.crypto_box_keypair();
    const publicKeyB64 = Buffer.from(kp.publicKey).toString('base64');

    ws.send(JSON.stringify({ t: 'get_server_key' }));
    const serverKeyMsg = await waitForType(ws, 'server_key');
    expect(serverKeyMsg.publicKey).toBeTruthy();
    const serverPk = Buffer.from(serverKeyMsg.publicKey, 'base64');

    ws.send(JSON.stringify({ t: 'client_key', publicKey: publicKeyB64 }));
    const ack = await waitForType(ws, 'client_key_ack');
    expect(ack.ok).toBe(true);

    return {
        clientSk: kp.privateKey,
        clientPk: kp.publicKey,
        serverPk,
    };
}

test('ping + join + session_ready + E2E exchange', async () => {
    const code = 'Abc123456789!@#$';
    const keyFromA = 'Abc123';
    const keyFromB = 'XyZ789';

    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);

        setTimeout(() => reject(new Error('Timeout spajanja A/B')), 5000);
    });

    wsA.send(JSON.stringify({ t: 'ping' }));
    const pong = await waitForType(wsA, 'pong');
    expect(pong.alive).toBe(true);

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    const readyAPromise = waitForInnerType(wsA, 'session_ready', ctxA);
    const readyBPromise = waitForInnerType(wsB, 'session_ready', ctxB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));

    const [sessionReadyA, sessionReadyB] = await Promise.all([
        readyAPromise,
        readyBPromise,
    ]);

    expect(sessionReadyA.code).toBe(code);
    expect(sessionReadyB.code).toBe(code);

    const receivedOnB = waitForInnerType(wsB, 'signal', ctxB);
    const receivedOnA = waitForInnerType(wsA, 'signal', ctxA);

    wsA.send(encryptClientToServer({
        t: 'signal',
        code,
        from: 'A',
        data: { publicKey: keyFromA },
    }, ctxA.serverPk, ctxA.clientSk));

    wsB.send(encryptClientToServer({
        t: 'signal',
        code,
        from: 'B',
        data: { publicKey: keyFromB },
    }, ctxB.serverPk, ctxB.clientSk));

    const [signalOnB, signalOnA] = await Promise.all([
        receivedOnB,
        receivedOnA,
    ]);

    expect(signalOnB.data.publicKey).toBe(keyFromA);
    expect(signalOnA.data.publicKey).toBe(keyFromB);

    wsA.close();
    wsB.close();
});

test('direct: first client joined = waiting_peer, second = connected + session_ready', async () => {
    const code = 'QqWwEeRrTtYyUu1!';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    const joinedAPromise = waitForInnerType(wsA, 'joined', ctxA);
    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    const joinedA = await joinedAPromise;
    expect(joinedA.roomState).toBe('waiting_peer');
    expect(joinedA.peersInRoom).toBe(1);

    const joinedBPromise = waitForInnerType(wsB, 'joined', ctxB);
    const readyAPromise = waitForInnerType(wsA, 'session_ready', ctxA);
    const readyBPromise = waitForInnerType(wsB, 'session_ready', ctxB);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    const joinedB = await joinedBPromise;
    expect(joinedB.roomState).toBe('connected');
    expect(joinedB.peersInRoom).toBe(2);

    const [srA, srB] = await Promise.all([readyAPromise, readyBPromise]);
    expect(srA.roomState).toBe('connected');
    expect(srB.roomState).toBe('connected');
    expect(srA.peersInRoom).toBe(2);
    expect(srB.peersInRoom).toBe(2);

    wsA.close();
    wsB.close();
});

test('INSIDE: inside_query + relay prije inside_confirm + inside_confirm', async () => {
    const code = '1234567890123456';
    const ws = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctx = await exchangeKeys(ws);

    ws.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctx.serverPk, ctx.clientSk));
    const joined1 = await waitForInnerType(ws, 'joined', ctx);
    expect(joined1.peersInRoom).toBe(1);

    const joined2Promise = waitForInnerType(ws, 'joined', ctx);
    const readyPromise = waitForInnerType(ws, 'session_ready', ctx);
    const queryPromise = waitForInnerType(ws, 'inside_query', ctx);
    ws.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctx.serverPk, ctx.clientSk));
    await joined2Promise;
    const sr = await readyPromise;
    expect(sr.insideProtocol).toBe(true);
    expect(sr.insideQuery).toBe(true);
    await queryPromise;

    const signalEcho = waitForInnerType(ws, 'signal', ctx);
    ws.send(encryptClientToServer({
        t: 'signal',
        code,
        from: 'A',
        data: { x: 1 },
    }, ctx.serverPk, ctx.clientSk));
    const sigBefore = await signalEcho;
    expect(sigBefore.data.x).toBe(1);

    ws.send(encryptClientToServer({
        t: 'inside_confirm',
        code,
        message: 'INSIDE test',
    }, ctx.serverPk, ctx.clientSk));
    await waitForInnerType(ws, 'inside_confirm_ack', ctx);
    const ic = await waitForInnerType(ws, 'inside_confirmed', ctx);
    expect(ic.code).toBe(code);

    ws.send(encryptClientToServer({ t: 'inside_hybrid', code }, ctx.serverPk, ctx.clientSk));
    await waitForInnerType(ws, 'inside_hybrid_ack', ctx);

    ws.close();
});

test('security ping_self + peer_ping / peer_pong relay', async () => {
    const code = 'SecPing1234567!@';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    wsA.send(encryptClientToServer({ t: 'ping_self', code }, ctxA.serverPk, ctxA.clientSk));
    const selfAck = await waitForInnerType(wsA, 'ping_self_ack', ctxA);
    expect(selfAck.category).toBe('ping_self');
    expect(selfAck.peersInRoom).toBe(2);
    expect(selfAck.roomState).toBe('connected');

    const peerPingOnB = waitForInnerType(wsB, 'peer_ping', ctxB);
    wsA.send(encryptClientToServer({
        t: 'peer_ping',
        code,
        nonce: 'n1',
        ts: Date.now(),
    }, ctxA.serverPk, ctxA.clientSk));
    const pingB = await peerPingOnB;
    expect(pingB.category).toBe('ping_peer');
    expect(pingB.code).toBe(code);

    const peerPongOnA = waitForInnerType(wsA, 'peer_pong', ctxA);
    wsB.send(encryptClientToServer({
        t: 'peer_pong',
        code,
        nonce: 'n1',
    }, ctxB.serverPk, ctxB.clientSk));
    const pongA = await peerPongOnA;
    expect(pongA.category).toBe('ping_peer');
    expect(pongA.code).toBe(code);

    wsA.close();
    wsB.close();
});

test('e2e_ready: oba klijenta → hibernacija; ping_self budi', async () => {
    const code = 'Ee2eStandby123!@';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    wsA.send(encryptClientToServer({ t: 'e2e_ready', code }, ctxA.serverPk, ctxA.clientSk));
    const ackA1 = await waitForInnerType(wsA, 'e2e_ready_ack', ctxA);
    expect(ackA1.hibernated).toBe(false);
    expect(ackA1.pendingPeer).toBe(true);

    const ackA2Promise = waitForInnerType(wsA, 'e2e_ready_ack', ctxA);
    const ackBPromise = waitForInnerType(wsB, 'e2e_ready_ack', ctxB);
    wsB.send(encryptClientToServer({ t: 'e2e_ready', code }, ctxB.serverPk, ctxB.clientSk));
    const [ackA2, ackB] = await Promise.all([ackA2Promise, ackBPromise]);
    expect(ackA2.hibernated).toBe(true);
    expect(ackB.hibernated).toBe(true);

    const roomsData = await new Promise((resolve, reject) => {
        http.get(`${HTTP_BASE}/api/rooms`, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
    const room = roomsData.rooms.find((r) => r.pin === code);
    expect(room).toBeTruthy();
    expect(room.hibernated).toBe(true);

    wsA.send(encryptClientToServer({ t: 'ping_self', code }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'ping_self_ack', ctxA);

    const roomsAfterWake = await new Promise((resolve, reject) => {
        http.get(`${HTTP_BASE}/api/rooms`, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
    const roomAfter = roomsAfterWake.rooms.find((r) => r.pin === code);
    expect(roomAfter.hibernated).toBe(false);

    wsA.close();
    wsB.close();
});

test('GET /api/room-code/check validates client candidate code', async () => {
    const freeCode = 'ZZzzZZzzZZzzZZzz'; // unlikely occupied in empty server
    const data = await new Promise((resolve, reject) => {
        http.get(`${HTTP_BASE}/api/room-code/check?code=${encodeURIComponent(freeCode)}`, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });

    expect(data.valid).toBe(true);
    expect(data).toHaveProperty('available');
    expect(data).toHaveProperty('occupied');
    expect(data).toHaveProperty('sources');
    expect(data.sources).toHaveProperty('inMemorySession');
    expect(data.sources).toHaveProperty('inDatabase');
    expect(data.sources).toHaveProperty('reserved');
    expect(data.available).toBe(!data.occupied);
});

test('GET /api/room-code returns unique 16-char code', async () => {
    const data = await new Promise((resolve, reject) => {
        http.get(`${HTTP_BASE}/api/room-code`, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });

    expect(data.code).toBeTruthy();
    expect(data.code.length).toBe(16);
    expect(/^[\x20-\x7E]{16}$/.test(data.code)).toBe(true);
});

test('GET /api/rooms returns rooms and database arrays', async () => {
    const data = await new Promise((resolve, reject) => {
        http.get(`${HTTP_BASE}/api/rooms`, (res) => {
            let buf = '';
            res.on('data', (c) => {
                buf += c;
            });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(buf));
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });

    expect(data).toHaveProperty('rooms');
    expect(data).toHaveProperty('database');
    expect(Array.isArray(data.rooms)).toBe(true);
    expect(Array.isArray(data.database)).toBe(true);
});

test('signal i msg bez joina → not_in_room', async () => {
    const code = 'NotInRoom12345!@';
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctx = await exchangeKeys(ws);

    ws.send(encryptClientToServer({
        t: 'signal',
        code,
        from: 'X',
        data: {},
    }, ctx.serverPk, ctx.clientSk));
    const errSignal = await waitForInnerError(ws, ctx);
    expect(errSignal.reason).toBe('not_in_room');

    ws.send(encryptClientToServer({
        t: 'msg',
        code,
        body: 'hi',
    }, ctx.serverPk, ctx.clientSk));
    const errMsg = await waitForInnerError(ws, ctx);
    expect(errMsg.reason).toBe('not_in_room');

    ws.close();
});

test('join s nevaljanim kodom → invalid_code', async () => {
    const ws = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctx = await exchangeKeys(ws);

    ws.send(encryptClientToServer({ t: 'join', code: 'short', mode: 'direct' }, ctx.serverPk, ctx.clientSk));
    const err = await waitForInnerError(ws, ctx);
    expect(err.reason).toBe('invalid_code');

    ws.close();
});

test('close_session: oba klijenta dobiju session_closed', async () => {
    const code = 'ClsS1234567890!@';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    const closedA = waitForInnerType(wsA, 'session_closed', ctxA);
    const closedB = waitForInnerType(wsB, 'session_closed', ctxB);

    wsA.send(encryptClientToServer({ t: 'close_session', code }, ctxA.serverPk, ctxA.clientSk));

    const [a, b] = await Promise.all([closedA, closedB]);
    expect(a.code).toBe(code);
    expect(b.code).toBe(code);
    expect(a.closedBy).toBe('self');
    expect(b.closedBy).toBe('peer');

    wsA.close();
    wsB.close();
});

test('POST /api/room-code/check vraća istu strukturu kao GET', async () => {
    const freeCode = 'PpPpPpPpPpPpPpPp';
    const { status, body } = await httpRequestJson(
        {
            hostname: '127.0.0.1',
            port: testPort(),
            path: '/api/room-code/check',
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
        },
        JSON.stringify({ code: freeCode }),
    );

    expect(status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body).toHaveProperty('occupied');
    expect(body).toHaveProperty('sources');
    expect(body.sources).toHaveProperty('inMemorySession');
});

test('group: tri klijenta u istoj sobi', async () => {
    const code = 'GrpRoom1234567!@';
    const ws1 = new WebSocket(WS_URL);
    const ws2 = new WebSocket(WS_URL);
    const ws3 = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 3) resolve();
        };
        ws1.on('open', onOpen);
        ws2.on('open', onOpen);
        ws3.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctx1 = await exchangeKeys(ws1);
    const ctx2 = await exchangeKeys(ws2);
    const ctx3 = await exchangeKeys(ws3);

    ws1.send(encryptClientToServer({ t: 'join', code, mode: 'group' }, ctx1.serverPk, ctx1.clientSk));
    const j1 = await waitForInnerType(ws1, 'joined', ctx1);
    expect(j1.mode).toBe('group');
    expect(j1.peersInRoom).toBe(1);
    expect(j1.roomState).toBe('active');

    ws2.send(encryptClientToServer({ t: 'join', code, mode: 'group' }, ctx2.serverPk, ctx2.clientSk));
    const j2 = await waitForInnerType(ws2, 'joined', ctx2);
    expect(j2.peersInRoom).toBe(2);

    ws3.send(encryptClientToServer({ t: 'join', code, mode: 'group' }, ctx3.serverPk, ctx3.clientSk));
    const j3 = await waitForInnerType(ws3, 'joined', ctx3);
    expect(j3.peersInRoom).toBe(3);

    const relay = waitForInnerType(ws2, 'msg', ctx2);
    ws1.send(encryptClientToServer({
        t: 'msg',
        code,
        body: 'hello-group',
    }, ctx1.serverPk, ctx1.clientSk));
    const got = await relay;
    expect(got.body).toBe('hello-group');

    ws1.close();
    ws2.close();
    ws3.close();
});

test('msg relay između dva peer-a u direct sobi', async () => {
    const code = 'MsgRelay123456!@';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    const onB = waitForInnerType(wsB, 'msg', ctxB);
    wsA.send(encryptClientToServer({
        t: 'msg',
        code,
        ciphertext: 'blob',
    }, ctxA.serverPk, ctxA.clientSk));
    const received = await onB;
    expect(received.ciphertext).toBe('blob');

    wsA.close();
    wsB.close();
});

test('direct: PIN od 16 nula, razmjena poruka A↔B i zatvaranje sobe', async () => {
    const code = '0000000000000000';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    const toB = waitForInnerType(wsB, 'msg', ctxB);
    wsA.send(encryptClientToServer({
        t: 'msg',
        code,
        text: 'poruka-a-primjer',
    }, ctxA.serverPk, ctxA.clientSk));
    const gotOnB = await toB;
    expect(gotOnB.text).toBe('poruka-a-primjer');

    const toA = waitForInnerType(wsA, 'msg', ctxA);
    wsB.send(encryptClientToServer({
        t: 'msg',
        code,
        text: 'poruka-b-odgovor',
    }, ctxB.serverPk, ctxB.clientSk));
    const gotOnA = await toA;
    expect(gotOnA.text).toBe('poruka-b-odgovor');

    const closedA = waitForInnerType(wsA, 'session_closed', ctxA);
    const closedB = waitForInnerType(wsB, 'session_closed', ctxB);
    wsA.send(encryptClientToServer({ t: 'close_session', code }, ctxA.serverPk, ctxA.clientSk));
    const [ca, cb] = await Promise.all([closedA, closedB]);
    expect(ca.code).toBe(code);
    expect(cb.code).toBe(code);
    expect(ca.closedBy).toBe('self');
    expect(cb.closedBy).toBe('peer');

    wsA.close();
    wsB.close();
});

test('direct: PIN 1111111111111111 — oba klijenta (regresija: ne smije biti krivo kao ping)', async () => {
    const code = '1111111111111111';
    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let opened = 0;
        const onOpen = () => {
            opened += 1;
            if (opened === 2) resolve();
        };
        wsA.on('open', onOpen);
        wsB.on('open', onOpen);
        setTimeout(() => reject(new Error('Timeout spajanja')), 5000);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    wsA.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    await waitForInnerType(wsA, 'joined', ctxA);

    wsB.send(encryptClientToServer({ t: 'join', code, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));
    await Promise.all([
        waitForInnerType(wsB, 'joined', ctxB),
        waitForInnerType(wsA, 'session_ready', ctxA),
        waitForInnerType(wsB, 'session_ready', ctxB),
    ]);

    wsA.close();
    wsB.close();
});
