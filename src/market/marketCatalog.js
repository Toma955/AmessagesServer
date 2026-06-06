/**
 * Lokalni Market katalog (usklađen s Nilternius iOS LocalMarketCatalogProvider).
 */

const VALID_CATEGORIES = new Set([
    'applications',
    'widgets',
    'themes',
    'islands',
    'icons',
]);

const ID_NUMBER_RANGES = [
    { category: 'applications', min: 10000, max: 19999 },
    { category: 'widgets', min: 20000, max: 29999 },
    { category: 'themes', min: 30000, max: 39999 },
    { category: 'islands', min: 40000, max: 49999 },
    { category: 'icons', min: 50000, max: 59999 },
];

/** @type {Array<{ id: string, idNumber: number, category: string, title: string, detail: string, version: string, systemImage?: string, iconUrl?: string | null, sizeBytes?: number | null, sha256?: string | null }>} */
const ITEMS = [
    {
        id: 'sah',
        idNumber: 10001,
        category: 'applications',
        miniAppPlacement: 'conversation',
        title: 'Šah',
        detail: 'Mini aplikacija razgovora — preuzmi s trgovine (#10001)',
        version: '1.0.0',
        systemImage: 'briefcase.fill',
    },
    {
        id: 'diplomaticBriefcase',
        idNumber: 10002,
        category: 'applications',
        miniAppPlacement: 'platform',
        title: 'Diplomatska aktovka',
        detail: 'Mini aplikacija platforme',
        version: '1.0.0',
        systemImage: 'briefcase.fill',
    },
    {
        id: 'search',
        idNumber: 20001,
        category: 'widgets',
        title: 'Traka pretrage',
        detail: 'Widget pretrage na Island traci',
        version: '1.0.0',
        systemImage: 'magnifyingglass',
    },
    {
        id: 'networkSpeed',
        idNumber: 20002,
        category: 'widgets',
        title: 'Brzina mreže',
        detail: 'Prikaz brzine preuzimanja / slanja',
        version: '1.0.0',
        systemImage: 'antenna.radiowaves.left.and.right',
    },
    {
        id: 'themeClassic',
        idNumber: 30001,
        category: 'themes',
        title: 'Klasična tema',
        detail: 'Tamna pozadina, narančasti akcent',
        version: '1.0.0',
        systemImage: 'paintpalette.fill',
    },
    {
        id: 'themeMidnight',
        idNumber: 30002,
        category: 'themes',
        title: 'Ponoć',
        detail: 'Plavi tonovi za noćni način rada',
        version: '1.0.0',
        systemImage: 'moon.stars.fill',
    },
    {
        id: 'islandProGlass',
        idNumber: 40001,
        category: 'islands',
        title: 'Pro staklo',
        detail: 'Island skin — stakleni efekt',
        version: '1.0.0',
        systemImage: 'capsule.fill',
    },
    {
        id: 'emojiPackHr',
        idNumber: 50001,
        category: 'icons',
        title: 'HR emoji paket',
        detail: 'Smajlici i ikone za chat',
        version: '1.0.0',
        systemImage: 'face.smiling.fill',
    },
];

function isValidCategory(category) {
    return VALID_CATEGORIES.has(String(category || '').toLowerCase());
}

function catalogForCategory(category) {
    const cat = String(category || '').toLowerCase();
    if (!isValidCategory(cat)) return null;
    return ITEMS.filter((item) => item.category === cat);
}

function itemById(itemId) {
    return ITEMS.find((item) => item.id === itemId) || null;
}

function itemByIdNumber(idNumber) {
    const num = Number(idNumber);
    if (!Number.isInteger(num) || num <= 0) return null;
    return ITEMS.find((item) => item.idNumber === num) || null;
}

function categoryForIdNumber(idNumber) {
    const num = Number(idNumber);
    if (!Number.isInteger(num)) return null;
    const range = ID_NUMBER_RANGES.find((r) => num >= r.min && num <= r.max);
    return range ? range.category : null;
}

function manifestForItem(item) {
    return {
        itemId: item.id,
        id: item.id,
        idNumber: item.idNumber,
        category: item.category,
        version: item.version,
        downloadUrl: null,
        sha256: item.sha256 || null,
        sizeBytes: item.sizeBytes || null,
        minHostAppVersion: '1.0.0',
    };
}

function validateIdNumber(idNumber) {
    const num = Number(idNumber);
    if (!Number.isInteger(num) || num <= 0) {
        return { valid: false, exists: false, idNumber: null, reason: 'not_numeric' };
    }

    const item = itemByIdNumber(num);
    if (item) {
        return {
            valid: true,
            exists: true,
            idNumber: num,
            id: item.id,
            category: item.category,
            title: item.title,
            reason: null,
        };
    }

    const category = categoryForIdNumber(num);
    if (category) {
        return {
            valid: true,
            exists: false,
            idNumber: num,
            id: null,
            category,
            title: null,
            reason: 'not_found',
        };
    }

    return {
        valid: false,
        exists: false,
        idNumber: num,
        id: null,
        category: null,
        title: null,
        reason: 'out_of_range',
    };
}

function itemDetailResponse(item) {
    return {
        ...item,
        latestVersion: item.version,
        publishedAt: '2026-06-01T12:00:00Z',
    };
}

module.exports = {
    VALID_CATEGORIES,
    ID_NUMBER_RANGES,
    ITEMS,
    isValidCategory,
    catalogForCategory,
    itemById,
    itemByIdNumber,
    categoryForIdNumber,
    manifestForItem,
    validateIdNumber,
    itemDetailResponse,
};
