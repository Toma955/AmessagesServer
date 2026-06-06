const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACKAGES_DIR = path.join(__dirname, '..', '..', 'data', 'market', 'packages');

/** @type {Array<{ itemId: string, version: string }>} */
const HOSTED_PACKAGES = [
    { itemId: 'sah', version: '1.0.0' },
];

function packageFileName(itemId, version) {
    return `${itemId}-${version}.pkg`;
}

function packageFilePath(itemId, version) {
    return path.join(PACKAGES_DIR, packageFileName(itemId, version));
}

function packageInfo(itemId, version) {
    const filePath = packageFilePath(itemId, version);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const data = fs.readFileSync(filePath);
    return {
        itemId,
        version,
        filePath,
        fileName: packageFileName(itemId, version),
        sizeBytes: data.length,
        sha256: crypto.createHash('sha256').update(data).digest('hex'),
        downloadUrl: `/api/market/items/${itemId}/packages/${version}`,
    };
}

function packageInfoForItem(item) {
    if (!item) return null;
    const hosted = HOSTED_PACKAGES.find((p) => p.itemId === item.id && p.version === item.version);
    if (!hosted) return null;
    return packageInfo(hosted.itemId, hosted.version);
}

function readPackageBuffer(itemId, version) {
    const info = packageInfo(itemId, version);
    if (!info) return null;
    return fs.readFileSync(info.filePath);
}

module.exports = {
    PACKAGES_DIR,
    HOSTED_PACKAGES,
    packageInfo,
    packageInfoForItem,
    readPackageBuffer,
};
