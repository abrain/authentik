#!/usr/bin/env node

/**
 * @file Downloads the latest corepack tarball from the npm registry and stores
 * it at .corepack/latest.tgz in the repo root.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { parseArgs } from "node:util";

import { createLogger, findNearestLockfile, parseCWD } from "./node/utils.mjs";

const logger = createLogger("update-corepack");

const REGISTRY_URL = "https://registry.npmjs.org/corepack";
const OUTPUT_DIR = ".corepack";
const OUTPUT_FILENAME = "latest.tgz";

async function main() {
    const parsedArgs = parseArgs({
        allowPositionals: true,
    });

    const cwd = parseCWD(parsedArgs.positionals);

    const lockfilePath = await findNearestLockfile(cwd);

    const repoRoot = dirname(lockfilePath);
    const outputDir = join(repoRoot, OUTPUT_DIR);
    const outputPath = join(outputDir, OUTPUT_FILENAME);

    logger.info("Fetching corepack metadata from registry...");
    const res = await fetch(REGISTRY_URL);

    if (!res.ok) {
        throw new Error(`Failed to fetch registry metadata: ${res.status} ${res.statusText}`);
    }

    const metadata = await res.json();

    const latestVersion = metadata["dist-tags"].latest;
    const versionData = metadata.versions[latestVersion];
    const tarballUrl = versionData.dist.tarball;
    const expectedIntegrity = versionData.dist.integrity;

    logger.info(`Latest corepack version: ${latestVersion}`);
    logger.info(`Tarball URL: ${tarballUrl}`);
    logger.info(`Expected integrity: ${expectedIntegrity}`);

    logger.info("Downloading tarball...");

    const tarballRes = await fetch(tarballUrl);

    if (!tarballRes.ok) {
        throw new Error(
            `Failed to download tarball: ${tarballRes.status} ${tarballRes.statusText}`,
        );
    }

    const tarballBuffer = Buffer.from(await tarballRes.arrayBuffer());

    logger.info("Verifying integrity...");
    const [algorithm, expectedHash] = expectedIntegrity.split("-");
    const actualHash = crypto.createHash(algorithm).update(tarballBuffer).digest("base64");

    if (actualHash !== expectedHash) {
        throw new Error(
            `Integrity mismatch!\n  Expected: ${expectedHash}\n  Actual:   ${actualHash}`,
        );
    }

    logger.info("Integrity verified.");

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputPath, tarballBuffer);

    logger.info(`Saved to ${relative(repoRoot, outputPath)}`);
    logger.info(`corepack@${latestVersion} (${expectedIntegrity})`);
}

main().catch((error) => {
    logger.error(error);
    process.exit(1);
});
