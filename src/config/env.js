require('dotenv').config({ quiet: true });

function getConfig() {
    const syncMs = parseInt(process.env.SYNC_DB_INTERVAL_MS || '300000', 10);
    return {
        PORT: process.env.PORT || 3000,
        NODE_ENV: process.env.NODE_ENV || 'development',
        /** 0 = bez periodičkog synca RAM→SQLite */
        SYNC_DB_INTERVAL_MS: Number.isFinite(syncMs) ? Math.max(0, syncMs) : 300000,
        /** Ako je postavljen, admin API (dnevnik sobe, prekid strane, SSE) traži Bearer ili X-Admin-Token. */
        ADMIN_TOKEN: process.env.ADMIN_TOKEN || '',
    };
}

module.exports = { getConfig };
