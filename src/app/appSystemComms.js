/**
 * Server ↔ aplikacija: ažuriranja host appa, Market stavki i sistemske obavijesti.
 */

const pkg = require('../../package.json');
const { ITEMS } = require('../market/marketCatalog');

const HOST_APP = {
    minVersion: '1.0.0',
    latestVersion: '1.0.0',
    updateUrl: null,
};

/** @type {Array<{ id: string, type: string, priority: string, title: string, message: string, publishedAt: string, expiresAt?: string | null, requiresAction?: boolean, metadata?: Record<string, string> }>} */
const ANNOUNCEMENTS = [
    {
        id: 'welcome-market-v1',
        type: 'system_update',
        priority: 'normal',
        title: 'Trgovina je aktivna',
        message: 'Mini aplikacije (npr. Šah #10001) možete preuzeti u Market → Aplikacije.',
        publishedAt: '2026-06-01T10:00:00Z',
        expiresAt: null,
        requiresAction: false,
        metadata: { action: 'open_market', category: 'applications' },
    },
];

const FEATURE_FLAGS = {
    marketEnabled: true,
    maintenanceMode: false,
    voipEnabled: true,
    systemCommsEnabled: true,
};

function parseInstalledItems(raw) {
    if (!raw || typeof raw !== 'string') {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            return [];
        }
        return parsed
            .filter((row) => row && typeof row.itemId === 'string' && typeof row.version === 'string')
            .map((row) => ({
                itemId: row.itemId,
                category: typeof row.category === 'string' ? row.category : 'applications',
                version: row.version,
            }));
    } catch {
        return [];
    }
}

function compareVersions(installed, latest) {
    if (!installed || !latest) {
        return installed !== latest;
    }
    const a = installed.split('.').map((n) => parseInt(n, 10) || 0);
    const b = latest.split('.').map((n) => parseInt(n, 10) || 0);
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i += 1) {
        const left = a[i] || 0;
        const right = b[i] || 0;
        if (left < right) return true;
        if (left > right) return false;
    }
    return false;
}

function hostAppSection(clientVersion) {
    const updateRequired = compareVersions(clientVersion, HOST_APP.minVersion);
    const updateAvailable = compareVersions(clientVersion, HOST_APP.latestVersion);
    return {
        minVersion: HOST_APP.minVersion,
        latestVersion: HOST_APP.latestVersion,
        clientVersion: clientVersion || null,
        updateRequired,
        updateAvailable,
        updateUrl: HOST_APP.updateUrl,
        message: updateRequired
            ? 'Ažurirajte Nilternius na podržanu verziju prije spajanja na server.'
            : (updateAvailable ? 'Dostupna je novija verzija Nilternius aplikacije.' : null),
    };
}

function marketUpdatesSection(installedItems) {
    const installedById = new Map(installedItems.map((row) => [row.itemId, row]));
    const updates = [];

    for (const item of ITEMS) {
        const installed = installedById.get(item.id);
        const installedVersion = installed ? installed.version : null;
        const updateAvailable = installedVersion
            ? compareVersions(installedVersion, item.version)
            : false;

        updates.push({
            itemId: item.id,
            idNumber: item.idNumber,
            category: item.category,
            title: item.title,
            installedVersion,
            latestVersion: item.version,
            updateAvailable,
            installed: installedVersion != null,
        });
    }

    return updates;
}

function activeAnnouncements(now = new Date()) {
    return ANNOUNCEMENTS.filter((entry) => {
        if (!entry.expiresAt) {
            return true;
        }
        const expires = Date.parse(entry.expiresAt);
        return Number.isNaN(expires) || expires > now.getTime();
    });
}

/**
 * @param {{ appVersion?: string, platform?: string, locale?: string, installedItemsRaw?: string }} query
 */
function buildSystemComms(query = {}) {
    const clientVersion = (query.appVersion || '').trim();
    const installedItems = parseInstalledItems(query.installedItemsRaw);

    return {
        serverTime: new Date().toISOString(),
        platform: query.platform || 'ios',
        locale: query.locale || 'hr',
        hostApp: hostAppSection(clientVersion),
        notifications: activeAnnouncements(),
        updates: marketUpdatesSection(installedItems),
        featureFlags: FEATURE_FLAGS,
        service: 'amessages-server',
        serviceVersion: pkg.version || '1.0.0',
    };
}

module.exports = {
    HOST_APP,
    ANNOUNCEMENTS,
    FEATURE_FLAGS,
    buildSystemComms,
    compareVersions,
};
