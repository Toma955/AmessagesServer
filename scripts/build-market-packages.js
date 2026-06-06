#!/usr/bin/env node
/**
 * Gradi .pkg datoteke za Market (nilternius-package-v1).
 * Usage: node scripts/build-market-packages.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'data', 'market', 'packages');

const PACKAGE_SOURCES = [
    {
        itemId: 'sah',
        version: '1.0.0',
        sourceDir: path.join(ROOT, 'packages', 'applications', 'sah', '1.0.0'),
    },
];

function readUtf8File(filePath) {
    return fs.readFileSync(filePath, 'utf8');
}

function buildPackage({ itemId, version, sourceDir }) {
    const manifestSourcePath = path.join(sourceDir, 'manifest.source.json');
    if (!fs.existsSync(manifestSourcePath)) {
        throw new Error(`Missing manifest.source.json: ${manifestSourcePath}`);
    }

    const template = JSON.parse(readUtf8File(manifestSourcePath));
    const files = {};

    for (const relativePath of template.files) {
        const abs = path.join(sourceDir, relativePath);
        if (!fs.existsSync(abs)) {
            throw new Error(`Missing file for package ${itemId}@${version}: ${relativePath}`);
        }
        files[relativePath] = {
            encoding: 'utf8',
            content: readUtf8File(abs),
        };
    }

    const pkg = {
        format: 'nilternius-package-v1',
        manifest: template.manifest,
        files,
    };

    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    const outPath = path.join(OUT_DIR, `${itemId}-${version}.pkg`);
    const json = JSON.stringify(pkg);
    fs.writeFileSync(outPath, json, 'utf8');

    const sha256 = crypto.createHash('sha256').update(json).digest('hex');
    const sizeBytes = Buffer.byteLength(json, 'utf8');

    console.log(`Built ${outPath}`);
    console.log(`  sha256=${sha256}`);
    console.log(`  sizeBytes=${sizeBytes}`);

    return { outPath, sha256, sizeBytes };
}

function main() {
    for (const source of PACKAGE_SOURCES) {
        buildPackage(source);
    }
}

main();
