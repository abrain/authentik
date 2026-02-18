import { exec } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

/**
 * @file Utility functions for Node.js scripts.
 */

/**
 * Promisified version of {@linkcode exec} for easier async/await usage.
 */
export const execAsync = promisify(exec);

/**
 * @param {string[]} positionals
 * @returns {string} The resolved current working directory for the script
 */
export function parseCWD(positionals) {
    // `INIT_CWD` is present only if the script is run via npm.
    const initCWD = process.env.INIT_CWD || process.cwd();

    const cwd = (positionals.length ? path.resolve(initCWD, positionals[0]) : initCWD) + path.sep;
    return cwd;
}

/**
 * Creates a logger with the given prefix for all messages.
 * @param {string} prefix
 */
export function createLogger(prefix) {
    prefix = `[${prefix}]`;

    const logger = {
        info: console.info.bind(console, "INFO", prefix),
        error: console.error.bind(console, "ERROR", prefix),
        warn: console.warn.bind(console, "WARN", prefix),
        debug: console.debug.bind(console, "DEBUG", prefix),
    };

    return logger;
}

/**
 * Find the nearest directory containing both package.json and package-lock.json,
 * starting from the given directory and walking upward.
 *
 * @param {string} start The directory to start searching from.
 * @returns {Promise<string>} The path to the package-lock.json file.
 * @throws {Error} If no co-located package.json and package-lock.json are found.
 */
export async function findNearestLockfile(start) {
    let currentDir = start;

    while (currentDir !== path.dirname(currentDir)) {
        const packageJSONPath = path.join(currentDir, "package.json");
        const lockfilePath = path.join(currentDir, "package-lock.json");

        try {
            await Promise.all([fs.access(packageJSONPath), fs.access(lockfilePath)]);
            return lockfilePath;
        } catch {
            // Continue searching up the directory tree
        }

        currentDir = path.dirname(currentDir);
    }

    throw new Error(`No co-located package.json and package-lock.json found above ${start}`);
}

/**
 * @typedef {object} PackageJSON
 * @property {string} name
 * @property {string} version
 * @property {Record<string, string>} [dependencies]
 * @property {Record<string, string>} [devDependencies]
 * @property {Record<string, string>} [peerDependencies]
 * @property {Record<string, string>} [optionalDependencies]
 * @property {Record<string, string>} [engines]
 * @property {Record<string, string>} [devEngines]
 */

/**
 * @param {string} jsonPath
 * @returns {Promise<PackageJSON>}
 */
export function loadJSON(jsonPath) {
    return fs
        .readFile(jsonPath, "utf-8")
        .then(JSON.parse)
        .catch((cause) => {
            throw new Error(`Failed to load JSON file at ${jsonPath}`, { cause });
        });
}

/**
 * Checks whether the given file has uncommitted changes in git.
 *
 * @param {string} filePath
 * @returns {Promise<{ clean: boolean, available: boolean }>}
 */
export async function gitStatus(filePath) {
    try {
        const { stdout } = await execAsync(`git status --porcelain ${filePath}`);
        return { clean: !stdout.trim(), available: true };
    } catch {
        return { clean: false, available: false };
    }
}

/**
 * Logs the given error and its cause (if any) and exits the process with a failure code.
 * @param {unknown} error
 * @param {ReturnType<typeof createLogger>} logger
 * @returns {never}
 */
export function reportAndExit(error, logger) {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;

    logger.error(`❌ ${message}`);

    if (cause) {
        logger.error("Caused by:", cause);
    }

    process.exit(1);
}

/**
 * Parses a version range string, stripping any leading >= and normalizing to three parts.
 * @param {string} range
 * @returns {{ operator: ">=" | "=", version: string }}
 */
export function parseRange(range) {
    const hasGte = range.startsWith(">=");
    const raw = hasGte ? range.slice(2) : range;
    const parts = raw.split(".").map(Number);

    while (parts.length < 3) parts.push(0);

    return {
        operator: hasGte ? ">=" : "=",
        version: parts.join("."),
    };
}

/**
 * Compares two semantic version strings (e.g., "14.17.0").
 *
 * @param {string} a The first version string.
 * @param {string} b The second version string.
 * @returns {number}
 */
export function compareVersions(a, b) {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) {
        if (pa[i] > pb[i]) return 1;
        if (pa[i] < pb[i]) return -1;
    }
    return 0;
}
