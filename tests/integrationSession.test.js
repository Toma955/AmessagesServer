const WebSocket = require('ws');
const { server } = require('../src/server');

const WS_URL = 'ws://localhost:3000';

// globalni timeout za ovaj test file
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
                ws.off('message', handler); // makni listener nakon što nađemo poruku
                resolve(msg);
            }
        };

        ws.on('message', handler);
    });
}

afterAll((done) => {
    if (server && server.close) {
        server.close(() => done());
    } else {
        done();
    }
});

test('ping + join + session_ready + E2E exchange', async () => {
    const code = 'Abc123456789!@#$'; // 16 ASCII znakova
    const keyFromA = 'Abc123';
    const keyFromB = 'XyZ789';

    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    // 0) čekamo da se oba spoje
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

    // 1) ping A -> server alive?
    wsA.send(JSON.stringify({ t: 'ping' }));
    const pong = await waitForType(wsA, 'pong');
    expect(pong.alive).toBe(true);

    // 2) pripremi čekanje session_ready PRIJE join-a
    const readyAPromise = waitForType(wsA, 'session_ready');
    const readyBPromise = waitForType(wsB, 'session_ready');

    // 3) A i B šalju join s istim kodom
    wsA.send(JSON.stringify({ t: 'join', code, mode: 'direct' }));
    wsB.send(JSON.stringify({ t: 'join', code, mode: 'direct' }));

    const [sessionReadyA, sessionReadyB] = await Promise.all([
        readyAPromise,
        readyBPromise,
    ]);

    expect(sessionReadyA.code).toBe(code);
    expect(sessionReadyB.code).toBe(code);

    // 4) pripremi čekanje E2E ključeva PRIJE slanja signal poruka
    const receivedOnB = waitForType(wsB, 'signal');
    const receivedOnA = waitForType(wsA, 'signal');

    // 5) A i B šalju "ključeve"
    wsA.send(JSON.stringify({
        t: 'signal',
        code,
        from: 'A',
        data: { publicKey: keyFromA },
    }));

    wsB.send(JSON.stringify({
        t: 'signal',
        code,
        from: 'B',
        data: { publicKey: keyFromB },
    }));

    const [signalOnB, signalOnA] = await Promise.all([
        receivedOnB,
        receivedOnA,
    ]);

    expect(signalOnB.data.publicKey).toBe(keyFromA); // B dobio Abc123
    expect(signalOnA.data.publicKey).toBe(keyFromB); // A dobio XyZ789

    wsA.close();
    wsB.close();
});
