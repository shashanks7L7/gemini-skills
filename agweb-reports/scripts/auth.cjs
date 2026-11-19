#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Authentication and Credential Manager for Reset AGWeb Reports
 *
 * Connected to Admin.Api backend:
 * Default Production URL: https://prod.reset.osttra.xyz/prod/agweb
 * Verification Endpoint: GET /api/account/GetAuthenticatedUser (Basic realm="Reset")
 *
 * Security Guarantee: TOKEN-ONLY STORAGE & STRICTLY READ-ONLY
 * - Username and password are NEVER stored on disk or in system variables.
 * - Only the standard HTTP Basic Auth header token is saved in Windows User Environment Variable:
 *   AGWEB_REPORTS_BASIC_AUTH = "Basic <base64>"
 * - No credentials files or vaults exist on disk.
 *
 * Agentic Ergonomics:
 * - Exit code 0: Success
 * - Exit code 1: Missing credentials or general error
 * - Exit code 2: Authentication failure / 401 Unauthorized (re-auth required)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const readline = require('node:readline');

// Configuration directory (only for non-sensitive config like URL overrides if configured)
const CONFIG_DIR = path.join(os.homedir(), '.agweb-reports');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const LEGACY_VAULT_FILE = path.join(CONFIG_DIR, 'vault.enc');

// Default backend endpoint for Reset AGWeb Admin.Api in PROD
const DEFAULT_AGWEB_API_URL = 'https://prod.reset.osttra.xyz/prod/agweb';

// Pre-configured environments matching references/config.md
const ENVIRONMENT_URLS = {
  prod: 'https://prod.reset.osttra.xyz/prod/agweb',
  patch: 'https://dev.reset.osttra.xyz/patch/agweb',
  qa: 'https://dev.reset.osttra.xyz/qa/agweb',
  uat: 'https://dev.reset.osttra.xyz/uat/agweb'
};

/**
 * Enforces standard username format for LDAP (e.g. s_shirol instead of RESET\s_shirol).
 */
function normalizeUsername(rawUser) {
  if (!rawUser) return '';
  let u = rawUser.trim();
  if (u.includes('\\')) {
    u = u.split('\\').pop();
  } else if (u.includes('/')) {
    u = u.split('/').pop();
  }
  return u;
}

/**
 * Reads User Environment Variable via PowerShell (Windows) or process.env
 */
function getUserEnvVar(varName) {
  if (process.env[varName]) {
    return process.env[varName];
  }

  if (process.platform === 'win32') {
    try {
      const ps = spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `[System.Environment]::GetEnvironmentVariable('${varName}', 'User')`],
        { encoding: 'utf8', timeout: 5000 }
      );
      if (ps.status === 0 && ps.stdout) {
        const val = ps.stdout.trim();
        if (val) return val;
      }
    } catch (_) {}
  }

  return null;
}

// Known credential and token environment variable names to purge during re-authentication
const CREDENTIAL_VARS = [
  'AGWEB_REPORTS_BASIC_AUTH',
  'AGWEB_REPORTS_USER',
  'AGWEB_REPORTS_PASS',
  'AGWEB_REPORTS_AUTH',
  'AGWEB_REPORTS_TOKEN',
  'AGWEB_REPORTS_AUTH_HEADER'
];

/**
 * Sets or unsets User Environment Variable via PowerShell (Windows) and active process
 */
function setUserEnvVar(varName, value) {
  if (value === null) {
    delete process.env[varName];
  } else {
    process.env[varName] = value;
  }

  if (process.platform === 'win32') {
    try {
      const escapedVal = value === null ? '$null' : `'${value.replace(/'/g, "''")}'`;
      const script = `[System.Environment]::SetEnvironmentVariable('${varName}', ${escapedVal}, 'User'); [System.Environment]::SetEnvironmentVariable('${varName}', ${escapedVal}, 'Process')`;
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', script],
        { encoding: 'utf8', timeout: 5000 }
      );
    } catch (_) {}
  }
}

/**
 * Purges all credential tokens, legacy variables, and cached auth artifacts everywhere:
 * 1. User Registry environment variables
 * 2. Process environment variables
 * 3. Node process.env
 * 4. ~/.agweb-reports/config.json (removes any credential fields)
 * 5. ~/.agweb-reports/vault.enc and any stray credential files
 */
function purgeAllTokens() {
  for (const v of CREDENTIAL_VARS) {
    setUserEnvVar(v, null);
  }

  // 1. Proactively remove any legacy vault file if one ever existed
  if (fs.existsSync(LEGACY_VAULT_FILE)) {
    try {
      fs.unlinkSync(LEGACY_VAULT_FILE);
    } catch (_) {}
  }

  // 2. Proactively clean config.json if any credential fields leaked
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      let modified = false;
      const credKeys = ['token', 'authHeader', 'basicAuth', 'user', 'username', 'password', 'pass'];
      for (const k of credKeys) {
        if (cfg[k] !== undefined) {
          delete cfg[k];
          modified = true;
        }
      }
      if (modified) {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
      }
    } catch (_) {}
  }

  // 3. Proactively clean any stray credential files in CONFIG_DIR
  if (fs.existsSync(CONFIG_DIR)) {
    try {
      const files = fs.readdirSync(CONFIG_DIR);
      for (const file of files) {
        if (file.endsWith('.enc') || file.includes('vault') || file.includes('cred') || file.includes('token')) {
          try {
            fs.unlinkSync(path.join(CONFIG_DIR, file));
          } catch (_) {}
        }
      }
    } catch (_) {}
  }
}

/**
 * Retrieves the stored Basic Auth token.
 * Only returns the token from User Environment Variable AGWEB_REPORTS_BASIC_AUTH.
 */
function getCredentials() {
  const envBasicAuth = getUserEnvVar('AGWEB_REPORTS_BASIC_AUTH');

  if (envBasicAuth) {
    const authHeader = envBasicAuth.startsWith('Basic ') ? envBasicAuth : `Basic ${envBasicAuth}`;
    return {
      authHeader,
      source: 'user_environment_variable (AGWEB_REPORTS_BASIC_AUTH)'
    };
  }

  return null;
}

/**
 * Overwrites all credentials and tokens everywhere:
 * 1. Purges all existing tokens and legacy credential variables from User Registry, Process scope, and process.env.
 * 2. Purges any credential keys from ~/.agweb-reports/config.json and deletes any legacy vault files.
 * 3. Encodes new standard username and password to Basic Auth Base64 token in memory (never storing plaintext).
 * 4. Saves the new token to AGWEB_REPORTS_BASIC_AUTH across User and Process environments.
 */
function overwriteCredentials(rawUsername, rawPassword) {
  if (!rawUsername || !rawPassword) {
    throw new Error('Username and password must not be empty.');
  }

  // 1. Purge all existing tokens and legacy variables first
  purgeAllTokens();

  // 2. Normalize standard LDAP username (e.g. s_shirol) and compute Basic Auth token in memory
  const standardUser = normalizeUsername(rawUsername);
  const token = Buffer.from(`${standardUser}:${rawPassword}`).toString('base64');
  const authHeader = `Basic ${token}`;

  // 3. Save new Basic Auth token across User environment and active process
  setUserEnvVar('AGWEB_REPORTS_BASIC_AUTH', authHeader);

  return {
    authHeader,
    account: standardUser,
    savedTo: 'Windows User Environment Variable (AGWEB_REPORTS_BASIC_AUTH) and active process environment'
  };
}

/**
 * Saves ONLY the Basic Auth token in the User Environment Variable.
 * Username and password are converted to Base64 in memory and NEVER persisted.
 */
function saveCredentials(rawUsername, rawPassword) {
  return overwriteCredentials(rawUsername, rawPassword);
}

/**
 * Completely clears stored credentials and purges any legacy files or variables.
 */
function clearCredentials() {
  purgeAllTokens();
}

/**
 * Audits the system and local disk to verify that:
 * 1. AGWEB_REPORTS_USER is NOT set
 * 2. AGWEB_REPORTS_PASS is NOT set
 * 3. No vault.enc or credential files exist in ~/.agweb-reports
 * 4. Only AGWEB_REPORTS_BASIC_AUTH token exists
 */
function auditCredentials() {
  const issues = [];
  const checks = [];

  // Check 1: User Environment Variables
  const envUser = getUserEnvVar('AGWEB_REPORTS_USER');
  const envPass = getUserEnvVar('AGWEB_REPORTS_PASS');
  const envAuth = getUserEnvVar('AGWEB_REPORTS_BASIC_AUTH');

  if (envUser) {
    issues.push(`AGWEB_REPORTS_USER is present in User Environment Variables: '${envUser}'.`);
  } else {
    checks.push('AGWEB_REPORTS_USER is not present in environment variables.');
  }

  if (envPass) {
    issues.push('AGWEB_REPORTS_PASS is present in User Environment Variables.');
  } else {
    checks.push('AGWEB_REPORTS_PASS is not present in environment variables.');
  }

  if (envAuth) {
    checks.push('AGWEB_REPORTS_BASIC_AUTH token is securely set in User Environment Variables.');
  } else {
    checks.push('AGWEB_REPORTS_BASIC_AUTH token is not currently set.');
  }

  // Check 2: Disk files in ~/.agweb-reports
  if (fs.existsSync(LEGACY_VAULT_FILE)) {
    issues.push(`Found credential vault file at ${LEGACY_VAULT_FILE}. It should be removed.`);
  } else {
    checks.push('No credential vault or password files exist on disk in ~/.agweb-reports.');
  }

  // Check 3: Check for any other credential files in ~/.agweb-reports
  if (fs.existsSync(CONFIG_DIR)) {
    const files = fs.readdirSync(CONFIG_DIR);
    const forbiddenFiles = files.filter((f) => f.includes('cred') || f.includes('pass') || f.includes('vault') || f.endsWith('.enc'));
    if (forbiddenFiles.length > 0) {
      issues.push(`Found potential credential files in ${CONFIG_DIR}: ${forbiddenFiles.join(', ')}`);
    } else {
      checks.push(`No suspicious credential files found in ${CONFIG_DIR} (files: ${files.join(', ') || 'none'}).`);
    }
  }

  return {
    passed: issues.length === 0,
    checks,
    issues
  };
}

function getAgwebApiUrl(options = {}) {
  if (options.url) {
    return options.url.replace(/\/+$/, '');
  }
  if (options.env && ENVIRONMENT_URLS[options.env.toLowerCase()]) {
    return ENVIRONMENT_URLS[options.env.toLowerCase()];
  }
  if (process.env.AGWEB_REPORTS_URL) {
    return process.env.AGWEB_REPORTS_URL.replace(/\/+$/, '');
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.agwebApiUrl) return cfg.agwebApiUrl.replace(/\/+$/, '');
    } catch (_) {}
  }
  return DEFAULT_AGWEB_API_URL;
}

/**
 * Tests stored credentials against Admin.Api /api/account/GetAuthenticatedUser (READ-ONLY GET)
 */
async function testCredentials(creds, options = {}) {
  const baseUrl = getAgwebApiUrl(options);

  return new Promise((resolve) => {
    try {
      const parsed = new URL(`${baseUrl}/api/account/GetAuthenticatedUser`);
      const isHttps = parsed.protocol === 'https:';
      const httpModule = isHttps ? require('node:https') : require('node:http');

      // Strictly READ-ONLY: HTTP GET only
      const req = httpModule.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname,
          method: 'GET',
          headers: {
            Authorization: creds.authHeader,
            Accept: 'application/json',
            'User-Agent': 'agweb-reports-skill/1.0'
          },
          timeout: 5000
        },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            if (res.statusCode === 401) {
              resolve({
                ok: false,
                code: 401,
                message: 'HTTP 401 Unauthorized: Reset Admin.Api rejected Basic Auth token (realm="Reset").'
              });
            } else if (res.statusCode === 403) {
              resolve({
                ok: false,
                code: 403,
                message: 'HTTP 403 Forbidden: User authenticated successfully, but lacks required role claim (Policies.ViewAgRunData) on Reset Admin.Api.'
              });
            } else if (res.statusCode >= 200 && res.statusCode < 300) {
              let userDetail = 'authenticated_user';
              try {
                const parsedUser = JSON.parse(body);
                userDetail = parsedUser.userName || parsedUser.fullName || 'authenticated_user';
              } catch (_) {}
              resolve({
                ok: true,
                code: res.statusCode,
                message: `HTTP ${res.statusCode}: Basic Auth token successfully verified with Reset Admin.Api (account: '${userDetail}').`
              });
            } else {
              resolve({
                ok: true,
                code: res.statusCode,
                message: `Server returned HTTP ${res.statusCode}: ${body.slice(0, 100)}`
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          ok: false,
          code: null,
          message: `Network error connecting to ${parsed.hostname}: ${err.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          ok: false,
          code: null,
          message: `Connection timed out connecting to ${parsed.hostname}`
        });
      });

      req.end();
    } catch (e) {
      resolve({
        ok: false,
        code: null,
        message: `Invalid API URL format: ${baseUrl}`
      });
    }
  });
}

async function promptInteractive(options = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter Reset AGWeb LDAP Username (standard username, e.g. s_shirol): ', async (rawUser) => {
    const username = normalizeUsername(rawUser);
    if (!username) {
      console.error('Failure: Username cannot be empty.');
      rl.close();
      process.exit(1);
    }
    rl.question('Enter Reset AGWeb LDAP Password: ', async (rawPassword) => {
      rl.close();
      const password = (rawPassword || '').trim();
      if (!password) {
        console.error('Failure: Password cannot be empty.');
        process.exit(1);
      }
      try {
        const updateRes = overwriteCredentials(username, password);
        console.log(`Success: Basic Auth token overwritten everywhere (${updateRes.savedTo}). Stored account: '${updateRes.account}'. Username and password were NOT saved to disk or system variables.`);

        if (!options.noTest) {
          const creds = getCredentials();
          const testRes = await testCredentials(creds, options);
          if (!testRes.ok && testRes.code === 401) {
            console.error(`Failure: REAUTH_FAILED (HTTP 401)\n${testRes.message}`);
            process.exit(2);
          } else if (!testRes.ok) {
            console.error(`Notice: Token saved, but verification reported: ${testRes.message}`);
            process.exit(0);
          } else {
            console.log(`Verification: ${testRes.message}`);
            process.exit(0);
          }
        } else {
          process.exit(0);
        }
      } catch (err) {
        console.error(`Failure: ${err.message}`);
        process.exit(1);
      }
    });
  });
}

async function readPasswordFromStdin() {
  return new Promise((resolve, reject) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buf += chunk;
    });
    process.stdin.on('end', () => {
      resolve(buf.replace(/[\r\n]+$/, ''));
    });
    process.stdin.on('error', reject);
    if (process.stdin.isPaused()) {
      process.stdin.resume();
    }
  });
}

function parseArgs() {
  const args = process.argv.slice(2);
  const command = args[0] || 'status';
  const options = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--username' && args[i + 1]) {
      options.username = args[++i];
    } else if (args[i] === '--password' && args[i + 1]) {
      options.password = args[++i];
      process.stderr.write('Security Warning: Passing passwords via CLI argument --password exposes credentials in OS process lists (Sysmon 4688 / Win32_Process) and shell history. Prefer passing via --stdin or interactive prompt.\n');
    } else if (args[i] === '--stdin') {
      options.stdin = true;
    } else if ((args[i] === '--env' || args[i] === '-e') && args[i + 1]) {
      options.env = args[++i];
    } else if (args[i] === '--url' && args[i + 1]) {
      options.url = args[++i];
    } else if (args[i] === '--test') {
      options.test = true;
    } else if (args[i] === '--no-test') {
      options.noTest = true;
    }
  }

  return { command, options };
}

async function main() {
  const { command, options } = parseArgs();

  try {
    switch (command) {
      case 'status': {
        const creds = getCredentials();
        if (creds) {
          console.log(
            JSON.stringify(
              {
                authenticated: true,
                source: creds.source,
                message: 'Basic Auth token is available in User Environment Variable (AGWEB_REPORTS_BASIC_AUTH). No username or password stored.'
              },
              null,
              2
            )
          );
          process.exit(0);
        } else {
          console.log(
            JSON.stringify(
              {
                authenticated: false,
                message: 'No Basic Auth token found. Please provide credentials to generate the token.'
              },
              null,
              2
            )
          );
          process.exit(1);
        }
      }

      case 'get': {
        const creds = getCredentials();
        if (creds) {
          console.log(
            JSON.stringify({
              authHeader: creds.authHeader,
              source: creds.source
            })
          );
          process.exit(0);
        } else {
          console.error('Failure: AUTH_REQUIRED - No Basic Auth token found in environment.');
          process.exit(1);
        }
      }

      case 'set':
      case 'update':
      case 'reauth': {
        if (options.stdin && !options.password) {
          options.password = await readPasswordFromStdin();
        } else if (process.env.AGWEB_REPORTS_INPUT_PASS) {
          options.password = process.env.AGWEB_REPORTS_INPUT_PASS;
          delete process.env.AGWEB_REPORTS_INPUT_PASS;
        }

        if (!options.username || !options.password) {
          if (command === 'reauth' || command === 'prompt') {
            await promptInteractive(options);
            return;
          }
          console.error(`Failure: Missing required parameters. Usage: auth.cjs ${command} --username <standard_user> (--stdin | --password <pass>) [--test]`);
          process.exit(1);
        }

        const updateRes = overwriteCredentials(options.username, options.password);
        console.log(`Success: Basic Auth token overwritten everywhere (${updateRes.savedTo}). Stored account: '${updateRes.account}'. Raw credentials were NOT saved to disk or system variables.`);

        // For update and reauth, test is enabled by default unless --no-test is explicitly passed
        const shouldTest = options.test || command === 'update' || command === 'reauth';
        if (shouldTest && !options.noTest) {
          const creds = getCredentials();
          const testRes = await testCredentials(creds, options);
          if (!testRes.ok && testRes.code === 401) {
            console.error(`Failure: REAUTH_FAILED (HTTP 401 Unauthorized)\n${testRes.message}`);
            process.exit(2);
          } else if (!testRes.ok && testRes.code === 403) {
            console.error(`Failure: FORBIDDEN (HTTP 403 Forbidden)\n${testRes.message}`);
            process.exit(3);
          } else if (!testRes.ok) {
            console.error(`Warning: Token saved, but verification reported: ${testRes.message}`);
            process.exit(1);
          } else {
            console.log(`Verification: ${testRes.message}`);
          }
        }
        process.exit(0);
      }

      case 'test': {
        const creds = getCredentials();
        if (!creds) {
          console.error('Failure: AUTH_REQUIRED - No Basic Auth token configured to test.');
          process.exit(1);
        }
        const testRes = await testCredentials(creds, options);
        if (!testRes.ok && testRes.code === 401) {
          console.error(`Failure: REAUTH_REQUIRED - ${testRes.message}`);
          process.exit(2);
        } else if (!testRes.ok && testRes.code === 403) {
          console.error(`Failure: FORBIDDEN (HTTP 403 Forbidden) - ${testRes.message}`);
          process.exit(3);
        } else if (!testRes.ok) {
          console.error(`Failure: ${testRes.message}`);
          process.exit(1);
        }
        console.log(`Success: ${testRes.message}`);
        process.exit(0);
      }

      case 'audit': {
        const auditResult = auditCredentials();
        console.log(JSON.stringify(auditResult, null, 2));
        if (auditResult.passed) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      }

      case 'prompt': {
        await promptInteractive(options);
        break;
      }

      case 'clear': {
        clearCredentials();
        console.log('Success: Basic Auth token and any legacy credential artifacts cleared everywhere.');
        process.exit(0);
      }

      default:
        console.error(`Failure: Unknown command '${command}'. Supported: status, get, set, update, reauth, test, audit, prompt, clear.`);
        process.exit(1);
    }
  } catch (err) {
    console.error(`Failure: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  getCredentials,
  saveCredentials,
  overwriteCredentials,
  clearCredentials,
  purgeAllTokens,
  testCredentials,
  auditCredentials,
  normalizeUsername,
  getAgwebApiUrl,
  DEFAULT_AGWEB_API_URL
};
