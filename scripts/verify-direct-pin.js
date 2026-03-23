#!/usr/bin/env node
/**
 * Provjera da dva WebSocket klijenta s istim PIN-om uđu u istu direct sobu.
 * Pokreni server: npm start
 * Zatim: npm run verify:direct
 * Ili: WS_URL=ws://192.168.1.10:3000 node scripts/verify-direct-pin.js
 */

const WebSocket = require('ws');
const sodium = require('libsodium-wrappers');

const WS_URL = process.env.WS_URL || 'ws://127.0.0.1:3000';
const PIN = process.env.PIN || '1111111111111111';
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS || 8000);

function waitForType(ws, expectedType) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout čekajući ${expectedType}`)), TIMEOUT_MS);
        const handler = (data) => {
            let msg;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return;
            }
            if (msg.t === expectedType) {
                clearTimeout(t);
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

function decryptServerToClient(boxMsg, serverPk, clientSk) {
    const nonce = Buffer.from(boxMsg.nonce, 'base64');
    const cipher = Buffer.from(boxMsg.c, 'base64');
    const plain = sodium.crypto_box_open_easy(cipher, nonce, serverPk, clientSk);
    return JSON.parse(Buffer.from(plain).toString('utf8'));
}

function waitForInnerType(ws, expectedInnerT, ctx) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timeout čekajući inner ${expectedInnerT}`)), TIMEOUT_MS);
        const handler = (data) => {
            try {
                const msg = JSON.parse(data.toString());
                if (msg.t !== 'box') return;
                const inner = decryptServerToClient(msg, ctx.serverPk, ctx.clientSk);
                if (inner.t === expectedInnerT) {
                    clearTimeout(t);
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

async function exchangeKeys(ws) {
    const kp = sodium.crypto_box_keypair();
    const publicKeyB64 = Buffer.from(kp.publicKey).toString('base64');

    ws.send(JSON.stringify({ t: 'get_server_key' }));
    const serverKeyMsg = await waitForType(ws, 'server_key');
    const serverPk = Buffer.from(serverKeyMsg.publicKey, 'base64');

    ws.send(JSON.stringify({ t: 'client_key', publicKey: publicKeyB64 }));
    const ack = await waitForType(ws, 'client_key_ack');
    if (!ack.ok) throw new Error('client_key_ack nije ok');

    return {
        clientSk: kp.privateKey,
        serverPk,
    };
}

async function main() {
    await sodium.ready;

    const wsA = new WebSocket(WS_URL);
    const wsB = new WebSocket(WS_URL);

    await new Promise((resolve, reject) => {
        let n = 0;
        const done = () => {
            n += 1;
            if (n === 2) resolve();
        };
        wsA.on('open', done);
        wsB.on('open', done);
        wsA.on('error', reject);
        wsB.on('error', reject);
        setTimeout(() => reject(new Error('WebSocket open timeout')), TIMEOUT_MS);
    });

    const ctxA = await exchangeKeys(wsA);
    const ctxB = await exchangeKeys(wsB);

    const joinedA = waitForInnerType(wsA, 'joined', ctxA);
    const joinedB = waitForInnerType(wsB, 'joined', ctxB);
    const readyA = waitForInnerType(wsA, 'session_ready', ctxA);
    const readyB = waitForInnerType(wsB, 'session_ready', ctxB);

    wsA.send(encryptClientToServer({ t: 'join', code: PIN, mode: 'direct' }, ctxA.serverPk, ctxA.clientSk));
    wsB.send(encryptClientToServer({ t: 'join', code: PIN, mode: 'direct' }, ctxB.serverPk, ctxB.clientSk));

    const jA = await joinedA;
    const jB = await joinedB;
    if (jA.roomState !== 'waiting_peer' && jA.peersInRoom !== 1) {
        console.warn('A joined:', jA);
    }
    if (jB.roomState !== 'connected' || jB.peersInRoom !== 2) {
        console.warn('B joined:', jB);
    }

    const [rA, rB] = await Promise.all([readyA, readyB]);
    if (rA.peersInRoom !== 2 || rB.peersInRoom !== 2) {
        throw new Error(`session_ready neočekivan: A=${JSON.stringify(rA)} B=${JSON.stringify(rB)}`);
    }

    wsA.close();
    wsB.close();

    console.log(`OK — direct soba "${PIN}" na ${WS_URL}: oba klijenta dobila session_ready (2 peer-a).`);
    process.exit(0);
}

main().catch((err) => {
    console.error('FAIL:', err.message);
    console.error('');
    console.error('Ako koristiš iOS Simulator: localhost u simulatoru NIJE tvoj Mac — stavi WS_URL=ws://<LAN-IP-Maca>:3000');
    console.error('Primjer: WS_URL=ws://192.168.0.5:3000 npm run verify:direct');
    process.exit(1);
});
