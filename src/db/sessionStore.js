const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logError } = require('../utils/logger');

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
 */
function persistSession(session) {
    if (!db) initSessionDb();

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
            client_count: session.clients.size,
            updated_at: updatedAt,
        });
    } catch (err) {
        logError('persistSession failed', err);
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
    removeSessionRecord,
    closeSessionDb,
    listAllSessionsFromDb,
};
