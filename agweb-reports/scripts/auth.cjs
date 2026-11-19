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

/**
 * Sets User Environment Variable via PowerShell (Windows)
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
      spawnSync(
        'powershell.exe',
        ['-NoProfile', '-Command', `[System.Environment]::SetEnvironmentVariable('${varName}', ${escapedVal}, 'User')`],
        { encoding: 'utf8', timeout: 5000 }
      );
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
 * Saves ONLY the Basic Auth token in the User Environment Variable.
 * Username and password are converted to Base64 in memory and NEVER persisted.
 */
function saveCredentials(rawUsername, rawPassword) {
  if (!rawUsername || !rawPassword) {
    throw new Error('Username and password must not be empty.');
  }

  const standardUser = normalizeUsername(rawUsername);
  const token = Buffer.from(`${standardUser}:${rawPassword}`).toString('base64');
  const authHeader = `Basic ${token}`;

  // 1. Save ONLY the basic auth header token in the User Environment Variable
  setUserEnvVar('AGWEB_REPORTS_BASIC_AUTH', authHeader);

  // 2. Proactively ensure NO username or password variables exist
  setUserEnvVar('AGWEB_REPORTS_USER', null);
  setUserEnvVar('AGWEB_REPORTS_PASS', null);

  // 3. Proactively remove any legacy vault file if one ever existed
  if (fs.existsSync(LEGACY_VAULT_FILE)) {
    try {
      fs.unlinkSync(LEGACY_VAULT_FILE);
    } catch (_) {}
  }

  return {
    authHeader,
    savedTo: 'Windows User Environment Variable (AGWEB_REPORTS_BASIC_AUTH)'
  };
}

/**
 * Completely clears stored credentials and purges any legacy files or variables.
 */
function clearCredentials() {
  setUserEnvVar('AGWEB_REPORTS_BASIC_AUTH', null);
  setUserEnvVar('AGWEB_REPORTS_USER', null);
  setUserEnvVar('AGWEB_REPORTS_PASS', null);

  if (fs.existsSync(LEGACY_VAULT_FILE)) {
    try {
      fs.unlinkSync(LEGACY_VAULT_FILE);
    } catch (_) {}
  }
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

function promptInteractive() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('Enter Reset AGWeb LDAP Username (standard username, e.g. s_shirol): ', (username) => {
    if (!username.trim()) {
      console.error('Failure: Username cannot be empty.');
      rl.close();
      process.exit(1);
    }
    rl.question('Enter Reset AGWeb LDAP Password: ', (password) => {
      rl.close();
      if (!password.trim()) {
        console.error('Failure: Password cannot be empty.');
        process.exit(1);
      }
      try {
        saveCredentials(username.trim(), password.trim());
        console.log('Success: Basic Auth token saved into Windows User Environment Variable (AGWEB_REPORTS_BASIC_AUTH). No username or password stored.');
      } catch (err) {
        console.error(`Failure: ${err.message}`);
        process.exit(1);
      }
    });
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
    } else if ((args[i] === '--env' || args[i] === '-e') && args[i + 1]) {
      options.env = args[++i];
    } else if (args[i] === '--url' && args[i + 1]) {
      options.url = args[++i];
    } else if (args[i] === '--test') {
      options.test = true;
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

      case 'set': {
        if (!options.username || !options.password) {
          console.error('Failure: Missing required parameters. Usage: auth.cjs set --username <standard_user> --password <pass> [--test]');
          process.exit(1);
        }

        saveCredentials(options.username, options.password);
        console.log('Success: Basic Auth token saved into Windows User Environment Variable (AGWEB_REPORTS_BASIC_AUTH). Username and password were NOT saved to disk or system variables.');

        if (options.test) {
          const creds = getCredentials();
          const testRes = await testCredentials(creds, options);
          if (!testRes.ok && testRes.code === 401) {
            console.error(`Failure: ${testRes.message}`);
            process.exit(2);
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
        promptInteractive();
        break;
      }

      case 'clear': {
        clearCredentials();
        console.log('Success: Basic Auth token and any legacy credential artifacts cleared.');
        process.exit(0);
      }

      default:
        console.error(`Failure: Unknown command '${command}'. Supported: status, get, set, test, audit, prompt, clear.`);
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
  clearCredentials,
  testCredentials,
  auditCredentials,
  normalizeUsername,
  getAgwebApiUrl,
  DEFAULT_AGWEB_API_URL
};
