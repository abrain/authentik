#!/usr/bin/env node
/**
 * @file Lints the package-lock.json file to ensure it is in sync with package.json.
 *
 * Usage:
 *   lint-lockfile [options] [directory]
 *
 * Options:
 *   --warn    Report issues as warnings instead of failing. The lockfile is
 *             still regenerated on disk, but the process exits 0.
 *
 * Exit codes:
 *   0  Lockfile is in sync (or --warn was passed)
 *   1  Unexpected error
 *   2  Lockfile drift detected
 */

import * as assert from "node:assert/strict";
import { exec } from "node:child_process";
import { findPackageJSON } from "node:module";
import * as path from "node:path";
import { isDeepStrictEqual, parseArgs, promisify } from "node:util";

import {
    createLogger,
    findNearestLockfile,
    gitStatus,
    loadJSON,
    parseCWD,
    reportAndExit,
} from "./node/utils.mjs";

//#region Utilities

const execAsync = promisify(exec);

const parsedArgs = parseArgs({
    options: {
        warn: {
            type: "boolean",
            default: false,
            description: "Report issues as warnings instead of failing",
        },
    },
    allowPositionals: true,
});

const logger = createLogger("lint:lockfile");

const { values: options, positionals } = parsedArgs;
const cwd = parseCWD(positionals);

/**
 * Exit code when lockfile drift is detected (distinct from general errors)
 */
const EXIT_DRIFT = 2;

/**
 * @returns {Promise<string[]>} The list of issues detected.
 */
async function run() {
    /** @type {string[]} */
    const issues = [];

    /**
     * Records an issue. In strict mode, throws immediately.
     * In warn mode, collects the message for later reporting.
     *
     * @param {boolean} ok
     * @param {string} message
     */
    const check = (ok, message) => {
        if (ok) return;

        if (options.warn) {
            issues.push(message);
            return;
        }

        assert.fail(message);
    };

    /**
     * Checks deep equality of two values. In strict mode, throws if they are not equal.
     * In warn mode, records an issue instead.
     *
     * @param {unknown} a
     * @param {unknown} b
     * @param {string} message
     */
    const checkDeep = (a, b, message) => {
        if (options.warn) {
            if (!isDeepStrictEqual(a, b)) {
                issues.push(message);
            }

            return;
        }

        assert.deepStrictEqual(a, b, message);
    };

    logger.info(`Checking lockfile integrity in: ${cwd}`);

    // MARK: Locate files

    const resolvedPath = import.meta.resolve(cwd);
    const packageJSONPath = findPackageJSON(resolvedPath);

    assert.ok(
        packageJSONPath,
        "Could not find package.json in the current directory or any parent directories",
    );

    const packageDir = path.dirname(packageJSONPath);
    const lockfilePath = await findNearestLockfile(packageDir);
    const lockfileDir = path.dirname(lockfilePath);
    const isWorkspace = lockfileDir !== packageDir;

    const before = {
        lockfile: await loadJSON(lockfilePath),
        package: await loadJSON(packageJSONPath),
    };

    logger.info(`package.json: ${packageJSONPath} (${before.package.name})`);
    logger.info(`package-lock.json: ${lockfilePath}${isWorkspace ? " (workspace root)" : ""}`);

    // MARK: Uncommitted changes

    const packageStatus = await gitStatus(packageJSONPath);
    const lockfileStatus = await gitStatus(lockfilePath);

    if (!packageStatus.available || !lockfileStatus.available) {
        logger.warn("Git is not available; skipping uncommitted change detection.");
    } else {
        check(packageStatus.clean, `package.json has uncommitted changes: ${packageJSONPath}`);

        check(lockfileStatus.clean, `package-lock.json has uncommitted changes: ${lockfilePath}`);
    }

    // MARK: Regenerate

    logger.info("Running npm install --package-lock-only...");

    const npmVersion = await execAsync("npm --version").then(({ stdout }) => stdout.trim());

    logger.info(`Detected npm version: ${npmVersion}`);

    await execAsync("npm install --package-lock-only", {
        cwd: lockfileDir,
    }).catch((cause) => {
        throw new Error("npm install --package-lock-only failed", { cause });
    });

    logger.info("npm install complete.");

    const after = {
        lockfile: await loadJSON(lockfilePath),
        package: await loadJSON(packageJSONPath),
    };

    // MARK: Compare

    assert.deepStrictEqual(
        before.package,
        after.package,
        `package.json was unexpectedly modified during lockfile check: ${packageJSONPath}`,
    );

    checkDeep(
        before.lockfile,
        after.lockfile,
        `package-lock.json is out of sync with package.json`,
    );

    return issues;
}

run()
    .then((issues) => {
        if (issues.length) {
            logger.warn(`⚠️  ${issues.length} issue(s) detected:`);

            for (const issue of issues) {
                logger.warn(`  - ${issue}`);
            }

            if (options.warn) {
                logger.warn(
                    "The lockfile on disk has been regenerated. Review and commit the changes.",
                );
                process.exit(EXIT_DRIFT);
            }
        } else {
            logger.info("✅ Lockfile is in sync.");
        }
    })
    .catch((error) => reportAndExit(error, logger));
