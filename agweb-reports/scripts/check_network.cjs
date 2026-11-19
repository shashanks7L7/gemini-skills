#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Company Network Verification Script for agweb-reports
 *
 * Verifies that the skill is operating on the internal corporate network/VPN.
 * Primary verification endpoint: https://prod.reset.osttra.xyz/prod/home/
 *
 * Agentic Ergonomics:
 * - Exit code 0: Connected to company network
 * - Exit code 1: Not on company network (halts execution)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const http = require('node:http');

const CONFIG_FILE = path.join(os.homedir(), '.agweb-reports', 'config.json');
const DEFAULT_NETWORK_URL = 'https://prod.reset.osttra.xyz/prod/home/';

function resolveNetworkUrl() {
  if (process.env.AGWEB_REPORTS_NETWORK_URL) {
    return process.env.AGWEB_REPORTS_NETWORK_URL;
  }
  if (process.env.AGWEB_REPORTS_NETWORK_HOST) {
    return `https://${process.env.AGWEB_REPORTS_NETWORK_HOST}`;
  }
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      if (cfg.networkUrl) return cfg.networkUrl;
      if (cfg.networkHost) return `https://${cfg.networkHost}`;
    } catch (_) {}
  }
  return DEFAULT_NETWORK_URL;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    url: resolveNetworkUrl(),
    skipCheck: false,
    mock: false
  };

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === '--url' || args[i] === '--host') && args[i + 1]) {
      const target = args[++i];
      options.url = target.startsWith('http://') || target.startsWith('https://') ? target : `https://${target}`;
    } else if (args[i] === '--skip-check' || args[i] === '--force') {
      options.skipCheck = true;
    } else if (args[i] === '--mock') {
      options.mock = true;
    }
  }

  return options;
}

/**
 * Performs a lightweight probe against the internal verification endpoint.
 * Any HTTP response (including 200, 302, 401, 403) proves reachability and network presence.
 */
function probeInternalEndpoint(targetUrl) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(targetUrl);
      const mod = parsed.protocol === 'https:' ? https : http;

      const req = mod.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': 'agweb-reports-network-check/1.0'
          },
          timeout: 4000
        },
        (res) => {
          // On internal corporate network, the server responds with 200, 302, or 401 Basic Challenge
          resolve({
            connected: true,
            statusCode: res.statusCode,
            detail: `Server responded with HTTP ${res.statusCode} (${parsed.hostname})`
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          connected: false,
          detail: `Network error: ${err.code || err.message}`
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          connected: false,
          detail: `Connection timed out after 4000ms connecting to ${parsed.hostname}`
        });
      });

      req.end();
    } catch (e) {
      resolve({
        connected: false,
        detail: `Invalid URL format: ${targetUrl}`
      });
    }
  });
}

async function verifyCompanyNetwork(options = {}) {
  const url = options.url || resolveNetworkUrl();

  if (options.skipCheck || options.mock || process.env.AGWEB_REPORTS_SKIP_NETWORK_CHECK === 'true') {
    return {
      connected: true,
      mode: 'mock_or_skipped',
      message: `Company network check skipped (test/mock mode active for '${url}').`
    };
  }

  const probe = await probeInternalEndpoint(url);
  if (probe.connected) {
    return {
      connected: true,
      mode: 'endpoint_verified',
      message: `Connected to company network (${probe.detail}).`
    };
  }

  return {
    connected: false,
    url,
    message: `Company network not detected. Internal verification endpoint '${url}' is unreachable (${probe.detail}). Please connect to corporate network or VPN.`
  };
}

async function main() {
  const options = parseArgs();
  const result = await verifyCompanyNetwork(options);

  if (result.connected) {
    console.log(`Success: ${result.message}`);
    process.exit(0);
  } else {
    console.error(`Failure: ${result.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  verifyCompanyNetwork,
  resolveNetworkUrl,
  DEFAULT_NETWORK_URL
};
