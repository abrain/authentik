#!/usr/bin/env node
/**
 * @file Lints the installed Node.js and npm versions against the requirements specified in package.json.
 *
 * Usage:
 *   lint-node [options] [directory]
 *
 * Exit codes:
 *   0  Versions are in sync
 *   1  Version mismatch detected
 */

import * as assert from "node:assert/strict";
import * as path from "node:path";
import { parseArgs } from "node:util";

import {
    compareVersions,
    createLogger,
    execAsync,
    findNearestLockfile,
    loadJSON,
    parseCWD,
    parseRange,
    reportAndExit,
} from "./node/utils.mjs";

const logger = createLogger("validate");

/**
 * @returns {Promise<string | null>} The installed Corepack version, or null if Corepack is not available.
 */
function readCorepackVersion() {
    return execAsync("corepack --version")
        .then((result) => result.stdout.trim())
        .catch(() => null);
}

/**
 *
 * @param {boolean} [useCorepack]
 * @returns {Promise<string>} The installed npm version.
 */
export function readNPMVersion(useCorepack = false) {
    const command = useCorepack ? "corepack npm --version" : "npm --version";
    return execAsync(command)
        .then((result) => result.stdout.trim())
        .catch((error) => {
            throw new Error(`Failed to execute "${command}": ${error.message}`, { cause: error });
        });
}

/**
 * @param {string} start
 */
async function readRequirements(start) {
    const lockfilePath = await findNearestLockfile(start);
    const packageJSONPath = path.join(path.dirname(lockfilePath), "package.json");

    logger.info("Checking versions in", packageJSONPath);

    const packageJSONData = await loadJSON(packageJSONPath);

    const nodeVersionResult = await execAsync("node --version");
    const nodeVersion = nodeVersionResult.stdout.trim().replace(/^v/, "");

    const requiredNpmVersion = packageJSONData.engines?.npm;
    const requiredNodeVersion = packageJSONData.engines?.node;

    return { nodeVersion, requiredNpmVersion, requiredNodeVersion };
}

async function main() {
    const parsedArgs = parseArgs({
        allowPositionals: true,
    });

    const cwd = parseCWD(parsedArgs.positionals);

    const corepackVersion = await readCorepackVersion();
    const npmVersion = await readNPMVersion(!!corepackVersion);

    const { nodeVersion, requiredNpmVersion, requiredNodeVersion } = await readRequirements(cwd);

    logger.info("corepack", corepackVersion || "disabled");
    logger.info(`npm${corepackVersion ? " (via Corepack)" : ""}`, npmVersion);
    logger.info("node", nodeVersion);

    if (requiredNpmVersion) {
        logger.info("package.json npm", requiredNpmVersion);

        const { operator, version: required } = parseRange(requiredNpmVersion);
        const result = compareVersions(npmVersion, required);

        assert.ok(
            operator === ">=" ? result >= 0 : result === 0,
            `npm version ${npmVersion} does not satisfy required version ${requiredNpmVersion}`,
        );
    }

    if (requiredNodeVersion) {
        logger.info("package.json node", requiredNodeVersion);

        const { operator, version: required } = parseRange(requiredNodeVersion);
        const result = compareVersions(nodeVersion, required);

        assert.ok(
            operator === ">=" ? result >= 0 : result === 0,
            `Node.js version ${nodeVersion} does not satisfy required version ${requiredNodeVersion}`,
        );
    }
}

main()
    .then(() => {
        logger.info("✅ Node.js and npm versions are in sync.");
    })
    .catch((error) => reportAndExit(error, logger));
