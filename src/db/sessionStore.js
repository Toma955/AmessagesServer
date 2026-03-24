const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/logger');
const { effectivePeerCount } = require('../utils/effectivePeerCount');

let db = null;

function getDbPath() {
    return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'amessages.db');
}

function initSessionDb() {
    if (db) return;

    const dbPath = getDbPath();

    try {
        if (dbPath !== ':memory:') {
            const dir = path.dirname(dbPath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        }

        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');

        db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                code TEXT PRIMARY KEY NOT NULL,
                type TEXT NOT NULL CHECK (type IN ('direct', 'group')),
                created_at TEXT NOT NULL,
                renew_count INTEGER NOT NULL DEFAULT 0,
                client_count INTEGER NOT NULL DEFAULT 0,
                updated_at TEXT NOT NULL
            );
        `);
    } catch (err) {
        logError('Failed to init session database', err);
        throw err;
    }
}

/**
 * Sinkronizira aktivnu sesiju (sobu) s bazom — WebSocket veze i dalje žive u memoriji.
 * @param {boolean} [force] ako true, upis i u hibernaciji (npr. wake, leave, ulazak u hibernaciju).
 */
function persistSession(session, force = false) {
    if (!db) initSessionDb();
    if (!force && session.hibernated) {
        return;
    }

    try {
        const updatedAt = new Date().toISOString();
        const createdIso = session.createdAt instanceof Date
            ? session.createdAt.toISOString()
            : session.createdAt;

        db.prepare(`
            INSERT INTO sessions (code, type, created_at, renew_count, client_count, updated_at)
            VALUES (@code, @type, @created_at, @renew_count, @client_count, @updated_at)
            ON CONFLICT(code) DO UPDATE SET
                renew_count = excluded.renew_count,
                client_count = excluded.client_count,
                updated_at = excluded.updated_at
        `).run({
            code: session.code,
            type: session.type,
            created_at: createdIso,
            renew_count: session.renewCount,
            client_count: effectivePeerCount(session),
            updated_at: updatedAt,
        });
    } catch (err) {
        logError('persistSession failed', err);
    }
}

function sessionCodeExists(code) {
    if (!db) initSessionDb();

    try {
        const row = db.prepare('SELECT 1 AS x FROM sessions WHERE code = ?').get(code);
        return !!row;
    } catch (err) {
        logError('sessionCodeExists failed', err);
        return false;
    }
}

function removeSessionRecord(code) {
    if (!db) initSessionDb();

    try {
        db.prepare('DELETE FROM sessions WHERE code = ?').run(code);
    } catch (err) {
        logError('removeSessionRecord failed', err);
    }
}

function closeSessionDb() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Zamjena cijele tablice stanjem iz RAM-a (jedna transakcija).
 * Briše sve retke i ponovno umetne aktivne sesije — baza = snimak RAM-a.
 */
function replaceAllSessionsFromMemory(rows) {
    if (!db) initSessionDb();

    try {
        const now = new Date().toISOString();
        const insert = db.prepare(`
            INSERT INTO sessions (code, type, created_at, renew_count, client_count, updated_at)
            VALUES (@code, @type, @created_at, @renew_count, @client_count, @updated_at)
        `);

        const tx = db.transaction((list) => {
            db.prepare('DELETE FROM sessions').run();
            for (const r of list) {
                insert.run({
                    code: r.code,
                    type: r.type,
                    created_at: r.created_at,
                    renew_count: r.renew_count ?? 0,
                    client_count: r.client_count,
                    updated_at: r.updated_at || now,
                });
            }
        });

        tx(rows);
    } catch (err) {
        logError('replaceAllSessionsFromMemory failed', err);
        throw err;
    }
}

/** Svi zapisi aktivnih sesija u SQLite (sinkronizirano s persistSession). */
function listAllSessionsFromDb() {
    if (!db) initSessionDb();

    try {
        const rows = db.prepare(`
            SELECT
                code AS pin,
                type,
                created_at AS createdAt,
                renew_count AS renewCount,
                client_count AS clientCount,
                updated_at AS updatedAt
            FROM sessions
            ORDER BY updated_at DESC
        `).all();
        return rows;
    } catch (err) {
        logError('listAllSessionsFromDb failed', err);
        return [];
    }
}

module.exports = {
    initSessionDb,
    persistSession,
    sessionCodeExists,
    removeSessionRecord,
    replaceAllSessionsFromMemory,
    closeSessionDb,
    listAllSessionsFromDb,
};
