#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Report Fetcher for Reset AGWeb Reports (Admin.Api)
 *
 * Connected to Admin.Api backend:
 * Default Production URL: https://prod.reset.osttra.xyz/prod/agweb
 * Network Verification: https://prod.reset.osttra.xyz/prod/home/
 *
 * Capabilities:
 * 1. Verifies internal corporate network / VPN connectivity
 * 2. Retrieves stored Reset corporate Basic Auth credentials (standard username format)
 * 3. Automated helper: Looks up the latest run ID for a currency (/api/v1/RunOrchestration/GetRuns)
 * 4. STRICTLY READ-ONLY: Only HTTP GET requests to read-only endpoints are permitted
 * 5. Dispatches queries to Admin.Api controllers (/api/reports/[action], /api/run/[action])
 * 6. Detects HTTP 401 Unauthorized and signals for re-authentication
 * 7. Returns clean, structured, LLM-friendly report data for analysis
 *
 * Agentic Ergonomics:
 * - Exit code 0: Success, report data returned
 * - Exit code 1: Network disconnected, missing credentials, or general error
 * - Exit code 2: HTTP 401 Unauthorized (re-authentication required)
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const https = require('node:https');

const { getCredentials, getAgwebApiUrl } = require('./auth.cjs');
const { verifyCompanyNetwork } = require('./check_network.cjs');

// Strict allowlist of permitted non-report read-only endpoints (lowercase)
const STRICT_ALLOWED_EXTRA_PATHS = new Set([
  '/api/account/getauthenticateduser',
  '/api/run/getruncurrencyinfo',
  '/api/v1/runorchestration/getruns',
  '/health'
]);

// Mapping of friendly report names to Admin.Api controller actions
const REPORT_ACTION_MAP = {
  summary: 'GetOptRunPortfolioSummaryReport',
  'run-summary': 'GetOptRunPortfolioSummaryReport',
  trades: 'GetOptTradeDetailsReport',
  'trade-details': 'GetOptTradeDetailsReport',
  'trades-summary': 'GetOptTradesSummaryReport',
  exposure: 'GetOptExposureReport',
  vega: 'GetOptDailyVegaChangeReport',
  'daily-vega': 'GetOptDailyVegaChangeReport',
  vol: 'GetOptVolReport',
  volatility: 'GetOptVolReport',
  pnl: 'GetOptPnlMaxReport',
  'pnl-max': 'GetOptPnlMaxReport',
  confirmation: 'GetConfirmationStatusReport',
  'confirmation-status': 'GetConfirmationStatusReport',
  'confirmation-summary': 'GetConfirmationStatusSummary',
  'dealer-orders': 'GetDealerOutstandingOrdersReport',
  gamma: 'GetOptGammaRawData',
  credit: 'GetOptCreditLimitReport',
  'credit-limits': 'GetOptCreditLimitReport',
  brokerage: 'GetOptBrokerageReport',
  hedges: 'GetOptDealerHedgeDetailsReport',
  'dealer-hedges': 'GetOptDealerHedgeDetailsReport',
  isin: 'GetIsinCodeReport',
  positions: 'GetOptPositionsReport',
  limits: 'GetOptLimitsReport',
  dv01: 'GetDv01Cascade',
  'dv01-cascade': 'GetDv01Cascade',
  'dv01-report': 'GetDv01Report',
  'discrete-ladder': 'GetOptDiscreteLadderReport',
  'legal-warnings': 'GetLegalEntityWarnings',
  'reuters-codes': 'GetReutersCodes',
  'sef-trader': 'GetSefTraderMapping',
  heatmap: 'GetOptHeatmapTargetDistributionReport',
  'opv-execution': 'GetOpvRunExecutionDealerReport',
  'client-clearing': 'GetClientClearingTradeReport',
  'opv-trades': 'GetOpvRunTradeReport',
  'enrolled-portfolios': 'GetOptEnrolledPortfolioDetails',
  'positions-metadata': 'GetOptPositionsMetadata',
  'positions-graphical': 'GetOptPositionsGraphicalReport',
  'dealer-summary': 'GetDealerSummaryRows',
  'dealer-currencies': 'GetDealerCurrenciesDetails',
  'markitwire-dealer': 'GetMarkitWireDealerDetails',
  'rtns-dealer': 'GetRtnsDealerDetails',
  'fxba-dealer': 'GetFxbaDealerDetails',
  'clearport-dealer': 'GetClearPortDealerDetails',
  'portfolio-setup': 'GetPortfolioSetupDetails',
  'dealer-history': 'GetDealerHistory'
};

function parseArgs() {
  const args = process.argv.slice(2);
  let command = 'report';

  if (args[0] === 'lookup-run' || args[0] === 'lookup' || args[0] === 'runs') {
    command = 'lookup-run';
    args.shift();
  } else if (args[0] === 'update-ref' || args[0] === 'update-reference') {
    command = 'update-ref';
    args.shift();
  } else if (args[0] === 'reauth' || args[0] === 'update-auth') {
    command = 'reauth';
    args.shift();
  }

  const options = {
    command,
    type: 'summary',
    runId: null,
    currency: null,
    username: null,
    password: null,
    query: '',
    endpoint: null,
    env: null,
    url: null,
    limit: 50,
    format: 'json',
    mock: false,
    skipNetworkCheck: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--username' || arg === '-u') && args[i + 1]) {
      options.username = args[++i];
    } else if ((arg === '--password' || arg === '-p') && args[i + 1]) {
      options.password = args[++i];
    } else if ((arg === '--type' || arg === '-t') && args[i + 1]) {
      options.type = args[++i].toLowerCase();
    } else if ((arg === '--run-id' || arg === '-r') && args[i + 1]) {
      options.runId = parseInt(args[++i], 10);
    } else if ((arg === '--currency' || arg === '-c') && args[i + 1]) {
      options.currency = args[++i].toUpperCase();
    } else if ((arg === '--env' || arg === '-e') && args[i + 1]) {
      options.env = args[++i].toLowerCase();
    } else if (arg === '--url' && args[i + 1]) {
      options.url = args[++i];
    } else if ((arg === '--query' || arg === '-q') && args[i + 1]) {
      options.query = args[++i];
    } else if (arg === '--endpoint' && args[i + 1]) {
      options.endpoint = args[++i];
    } else if (arg === '--limit' && args[i + 1]) {
      options.limit = parseInt(args[++i], 10) || 50;
    } else if (arg === '--format' && args[i + 1]) {
      options.format = args[++i].toLowerCase();
    } else if (arg === '--mock') {
      options.mock = true;
    } else if (arg === '--skip-network-check') {
      options.skipNetworkCheck = true;
    }
  }

  // Attempt to extract runId from query if not explicitly passed
  if (!options.runId && options.query) {
    const match = options.query.match(/(?:run\s*id|run)\s*[:=#]?\s*(\d{4,8})/i);
    if (match) {
      options.runId = parseInt(match[1], 10);
    }
  }

  // Attempt to extract currency code from query if not explicitly passed (e.g. USD, EUR, GBP, JPY, CAD, AUD, CHF)
  if (!options.currency && options.query) {
    const ccyMatch = options.query.match(/\b(USD|EUR|GBP|JPY|CAD|AUD|CHF|SEK|NOK|NZD|ZAR)\b/i);
    if (ccyMatch) {
      options.currency = ccyMatch[1].toUpperCase();
    }
  }

  return options;
}

// Set of all allowed report actions (all lowercase for case-insensitive matching)
const ALLOWED_REPORT_ACTIONS = new Set(
  Object.values(REPORT_ACTION_MAP).map((a) => a.toLowerCase())
);

/**
 * Enforces a STRICT ALLOWLIST for read-only safety on all API paths.
 * Replaces vulnerable mutating regex blocklists with an explicit allowlist:
 * 1. Must be a known GET report action under /api/reports/Get...
 * 2. Or must be explicitly listed in STRICT_ALLOWED_EXTRA_PATHS.
 * Rejects path traversal (..) and all unverified controllers/actions.
 */
function assertReadOnlyPath(apiPath) {
  if (!apiPath || typeof apiPath !== 'string') {
    throw new Error('SECURITY_VIOLATION: API path must be a non-empty string.');
  }

  // Prevent path traversal and protocol injection
  if (apiPath.includes('..') || apiPath.includes('\\') || apiPath.includes(':') || apiPath.includes('//')) {
    throw new Error(`SECURITY_VIOLATION: Path traversal or protocol injection detected in path: '${apiPath}'.`);
  }

  // Normalize path and extract pathname without query string
  const cleanPath = apiPath.split('?')[0].trim().toLowerCase();
  const normalizedPath = cleanPath.startsWith('/') ? cleanPath : `/${cleanPath}`;

  // Check 1: Known extra read-only endpoints
  if (STRICT_ALLOWED_EXTRA_PATHS.has(normalizedPath)) {
    return;
  }

  // Check 2: Must be an authorized report endpoint under /api/reports/
  if (normalizedPath.startsWith('/api/reports/')) {
    const actionSeg = normalizedPath.replace('/api/reports/', '').split('/')[0];
    // Must begin with 'get' (strictly GET read action)
    if (!actionSeg.startsWith('get')) {
      throw new Error(`SECURITY_VIOLATION: Non-GET action '${actionSeg}' is prohibited. Only read-only 'Get*' actions under /api/reports/ are permitted.`);
    }
    // Must be in verified allowed report actions or follow valid Get[a-z0-9] naming
    if (ALLOWED_REPORT_ACTIONS.has(actionSeg) || /^get[a-z0-9]+$/i.test(actionSeg)) {
      return;
    }
  }

  // Check 3: Raw action name passed
  const cleanAction = cleanPath.replace(/^\/+/, '');
  if (ALLOWED_REPORT_ACTIONS.has(cleanAction)) {
    return;
  }

  throw new Error(`SECURITY_VIOLATION: Endpoint '${apiPath}' is NOT on the strict read-only allowlist. Only verified GET report actions under /api/reports/Get* are permitted.`);
}

/**
 * Builds the Admin.Api path and query parameters
 */
function resolveApiPath(options) {
  if (options.endpoint) {
    assertReadOnlyPath(options.endpoint);
    return options.endpoint.startsWith('/') ? options.endpoint : `/${options.endpoint}`;
  }

  if (options.type === 'user' || options.type === 'account') {
    return '/api/account/GetAuthenticatedUser';
  }

  if (options.type === 'run-info') {
    return `/api/run/GetRunCurrencyInfo?runId=${options.runId || 0}`;
  }

  let action = REPORT_ACTION_MAP[options.type];
  if (!action) {
    // Check if options.type directly matches an action name (case-insensitive)
    const matched = Object.values(REPORT_ACTION_MAP).find(
      (a) => a.toLowerCase() === options.type.toLowerCase()
    );
    action = matched || 'GetOptRunPortfolioSummaryReport';
  }
  assertReadOnlyPath(action);

  if (action === 'GetLegalEntityWarnings' || action === 'GetOptPositionsMetadata') {
    return `/api/reports/${action}`;
  }

  if (action === 'GetConfirmationStatusReport' || action === 'GetConfirmationStatusSummary' || action === 'GetDealerOutstandingOrdersReport') {
    const rId = options.runId || 0;
    return `/api/reports/${action}?runIds=${rId}`;
  }

  if (action.startsWith('GetDealer') || action === 'GetPortfolioSetupDetails' || action === 'GetMarkitWireDealerDetails' || action === 'GetRtnsDealerDetails' || action === 'GetFxbaDealerDetails' || action === 'GetClearPortDealerDetails') {
    return `/api/reports/${action}`;
  }

  return `/api/reports/${action}?runId=${options.runId || 0}`;
}

/**
 * Generates mock runs list for testing or simulation mode
 */
function generateMockRuns() {
  return [
    { runId: 104820, status: 'Completed', productId: 1, product: 'IRS', currencyId: 1, currency: 'USD', tradeDate: '2026-11-17T00:00:00Z', titleDate: '2026-11-17T00:00:00Z', portalStatus: 'Approved' },
    { runId: 104818, status: 'Completed', productId: 1, product: 'IRS', currencyId: 2, currency: 'EUR', tradeDate: '2026-11-17T00:00:00Z', titleDate: '2026-11-17T00:00:00Z', portalStatus: 'Approved' },
    { runId: 104815, status: 'Completed', productId: 1, product: 'IRS', currencyId: 3, currency: 'GBP', tradeDate: '2026-11-16T00:00:00Z', titleDate: '2026-11-16T00:00:00Z', portalStatus: 'Approved' },
    { runId: 104810, status: 'Completed', productId: 1, product: 'IRS', currencyId: 4, currency: 'JPY', tradeDate: '2026-11-16T00:00:00Z', titleDate: '2026-11-16T00:00:00Z', portalStatus: 'Approved' },
    { runId: 104805, status: 'Completed', productId: 1, product: 'IRS', currencyId: 1, currency: 'USD', tradeDate: '2026-11-15T00:00:00Z', titleDate: '2026-11-15T00:00:00Z', portalStatus: 'Approved' },
    { runId: 104801, status: 'Completed', productId: 1, product: 'IRS', currencyId: 5, currency: 'CAD', tradeDate: '2026-11-14T00:00:00Z', titleDate: '2026-11-14T00:00:00Z', portalStatus: 'Approved' }
  ];
}

/**
 * Automated helper to look up the latest run ID for a currency
 */
async function lookupLatestRunForCurrency(baseUrl, currency, creds, mock = false) {
  const targetCcy = currency.toUpperCase();

  if (mock) {
    const mockRuns = generateMockRuns();
    const filtered = mockRuns.filter((r) => r.currency && r.currency.toUpperCase() === targetCcy);
    if (!filtered.length) {
      throw new Error(`No mock runs found for currency '${targetCcy}'. Available: USD, EUR, GBP, JPY, CAD.`);
    }
    filtered.sort((a, b) => b.runId - a.runId);
    return filtered[0];
  }

  // Live query to Admin.Api RunOrchestration/GetRuns
  const queryPath = '/api/v1/RunOrchestration/GetRuns?maxRunCount=100';
  const res = await queryAdminApi(baseUrl, queryPath, creds);

  if (!res.ok) {
    if (res.statusCode === 401) {
      const err = new Error('HTTP 401 Unauthorized');
      err.code = 401;
      throw err;
    }
    throw new Error(`Failed to query runs: ${res.message}`);
  }

  const runList = Array.isArray(res.data) ? res.data : [];
  if (!runList.length) {
    throw new Error(`No active runs returned from Admin.Api.`);
  }

  const matchingRuns = runList.filter((r) => r.currency && r.currency.toUpperCase() === targetCcy);
  if (!matchingRuns.length) {
    const availableCcy = Array.from(new Set(runList.map((r) => r.currency).filter(Boolean))).join(', ');
    throw new Error(`No runs found for currency '${targetCcy}'. Active currencies in recent runs: ${availableCcy || 'None'}`);
  }

  // Sort descending by runId to ensure latest run
  matchingRuns.sort((a, b) => (b.runId || 0) - (a.runId || 0));
  return matchingRuns[0];
}

/**
 * Generates mock report data for testing or offline demonstration
 */
function generateMockReport(options, creds) {
  const now = new Date();
  const runId = options.runId || 104820;
  const currency = options.currency || 'USD';

  return {
    metadata: {
      reportType: options.type,
      runId,
      currency,
      generatedAt: now.toISOString(),
      authenticatedUser: 'authenticated_user',
      source: 'Reset AGWeb Admin.Api (Simulation Mode)',
      environment: 'Corporate Network (https://prod.reset.osttra.xyz/prod/agweb)'
    },
    data: {
      runSummary: {
        runId,
        currency,
        status: 'Completed',
        portfoliosEnrolled: 28,
        totalTradesProposed: 1240,
        dv01ReductionPct: 64.2,
        grossPnlUsd: 2184500
      },
      portfolioMetrics: [
        { portfolio: `JPM_NY_${currency}_01`, initialDv01: 142500, finalDv01: 48200, reductionPct: 66.2, trades: 142 },
        { portfolio: `CITI_LDN_${currency}_02`, initialDv01: 112000, finalDv01: 39100, reductionPct: 65.1, trades: 118 },
        { portfolio: `BARC_LDN_${currency}_01`, initialDv01: 98000, finalDv01: 34800, reductionPct: 64.5, trades: 96 },
        { portfolio: `GS_NY_${currency}_03`, initialDv01: 89000, finalDv01: 31200, reductionPct: 64.9, trades: 88 }
      ],
      highlights: [
        `Run ${runId} achieved 64.2% DV01 reduction across all 28 participating dealer portfolios for ${currency}.`,
        'Zero credit limit or vega threshold violations detected during ladder optimization.',
        'All trade proposals match MarkitWire / SEF confirmation mapping rules.'
      ]
    }
  };
}

/**
 * Dispatches HTTP GET request with Basic Auth to Admin.Api (STRICTLY READ-ONLY)
 */
async function queryAdminApi(baseUrl, apiPath, creds) {
  assertReadOnlyPath(apiPath);

  return new Promise((resolve) => {
    try {
      const fullUrl = `${baseUrl}${apiPath}`;
      const parsed = new URL(fullUrl);
      const isHttps = parsed.protocol === 'https:';
      const httpModule = isHttps ? require('node:https') : require('node:http');

      // STRICTLY READ-ONLY: Method is permanently locked to GET
      const req = httpModule.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (isHttps ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            Authorization: creds.authHeader,
            Accept: 'application/json',
            'User-Agent': 'agweb-reports-skill/1.0'
          },
          timeout: 10000
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
                statusCode: 401,
                authFailed: true,
                message: 'HTTP 401 Unauthorized: Reset Admin.Api rejected Basic Auth credentials (realm="Reset").'
              });
            } else if (res.statusCode === 403) {
              resolve({
                ok: false,
                statusCode: 403,
                forbidden: true,
                message: 'HTTP 403 Forbidden: Authenticated user lacks required Policies.ViewAgRunData role claim.'
              });
            } else if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const parsedJson = JSON.parse(body);
                // Unpack GenericResponse<T> { success: true, data: ... }
                const reportData = parsedJson.data !== undefined ? parsedJson.data : parsedJson;
                resolve({
                  ok: true,
                  statusCode: res.statusCode,
                  data: reportData,
                  envelope: parsedJson.success !== undefined ? { success: parsedJson.success, message: parsedJson.message } : null
                });
              } catch (_) {
                resolve({
                  ok: true,
                  statusCode: res.statusCode,
                  rawText: body
                });
              }
            } else {
              resolve({
                ok: false,
                statusCode: res.statusCode,
                message: `Reset Admin.Api returned HTTP ${res.statusCode}: ${body.slice(0, 300)}`
              });
            }
          });
        }
      );

      req.on('error', (err) => {
        resolve({
          ok: false,
          networkError: true,
          errCode: err.code,
          message: err.message
        });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({
          ok: false,
          networkError: true,
          errCode: 'ETIMEDOUT',
          message: `Connection timed out connecting to ${parsed.hostname}`
        });
      });

      req.end();
    } catch (e) {
      resolve({
        ok: false,
        networkError: true,
        message: e.message
      });
    }
  });
}

async function main() {
  try {
    const options = parseArgs();

    // Enforce STRICT READ-ONLY safety check immediately
    if (options.endpoint) {
      assertReadOnlyPath(options.endpoint);
    }

    // Handle standalone command: update-ref
    if (options.command === 'update-ref') {
      const { fetchReportEndpointsFromSwagger, buildApiReferenceMarkdown } = require('./update_api_reference.cjs');
      const env = options.env || 'prod';
      const reportData = await fetchReportEndpointsFromSwagger(env);
      const markdown = buildApiReferenceMarkdown(reportData);
      const targetFile = path.resolve(__dirname, '..', 'references', 'api_reference.md');
      fs.writeFileSync(targetFile, markdown, 'utf8');
      console.log(`Success: Automatically updated '${targetFile}' with ${reportData.endpoints.length} GET report endpoints from ${reportData.name}.`);
      process.exit(0);
    }

    // Handle standalone command: reauth
    if (options.command === 'reauth') {
      const { overwriteCredentials, getCredentials, testCredentials } = require('./auth.cjs');
      if (!options.username || !options.password) {
        console.error('Failure: Missing credentials. Usage: node scripts/fetch_reports.cjs reauth --username <user> --password <pass>');
        process.exit(1);
      }
      const updateRes = overwriteCredentials(options.username, options.password);
      process.stderr.write(`Notice: Basic Auth token overwritten everywhere (${updateRes.savedTo}). Stored account: '${updateRes.account}'.\n`);
      const creds = getCredentials();
      const testRes = await testCredentials(creds, options);
      if (!testRes.ok && testRes.code === 401) {
        console.error(`Failure: REAUTH_FAILED (HTTP 401)\nReset Admin.Api rejected the provided credentials.`);
        process.exit(2);
      }
      console.log(JSON.stringify({ success: true, message: testRes.message, account: updateRes.account }, null, 2));
      process.exit(0);
    }

    // Step 1: Corporate Network Verification
    if (!options.skipNetworkCheck) {
      const netCheck = await verifyCompanyNetwork({ mock: options.mock });
      if (!netCheck.connected) {
        console.error(`Failure: COMPANY_NETWORK_REQUIRED\n${netCheck.message}`);
        process.exit(1);
      }
    }

    // Step 2: Retrieve Stored Basic Auth Credentials
    const creds = getCredentials();
    if (!creds) {
      console.error('Failure: AUTH_REQUIRED\nNo Basic Auth credentials found. Please prompt the user for their standard Reset LDAP username (e.g. s_shirol) and password, and store them using `node scripts/auth.cjs set --username <user> --password <pass>`.');
      process.exit(1);
    }

    const baseUrl = getAgwebApiUrl(options);

    // Handle standalone command: lookup-run
    if (options.command === 'lookup-run') {
      if (!options.currency) {
        console.error('Failure: Missing currency. Usage: node scripts/fetch_reports.cjs lookup-run --currency <USD|EUR|GBP|JPY|...>');
        process.exit(1);
      }
      try {
        const runInfo = await lookupLatestRunForCurrency(baseUrl, options.currency, creds, options.mock);
        console.log(JSON.stringify(runInfo, null, 2));
        process.exit(0);
      } catch (err) {
        if (err.code === 401 || err.message.includes('401')) {
          console.error('Failure: AUTH_FAILED\nHTTP 401 Unauthorized: Reset Admin.Api rejected Basic Auth credentials. Re-authentication required.');
          process.exit(2);
        }
        console.error(`Failure: ${err.message}`);
        process.exit(1);
      }
    }

    // If user passed currency but not runId, automatically lookup the latest run ID for that currency!
    if (!options.runId && options.currency) {
      try {
        const latestRun = await lookupLatestRunForCurrency(baseUrl, options.currency, creds, options.mock);
        options.runId = latestRun.runId;
        // Helpful notice in stderr so stdout stays pure JSON
        process.stderr.write(`Notice: Resolved latest run ID for ${options.currency} -> ${options.runId} (${latestRun.status || 'Active'}, ${latestRun.tradeDate || ''})\n`);
      } catch (err) {
        if (err.code === 401 || err.message.includes('401')) {
          console.error('Failure: AUTH_FAILED\nHTTP 401 Unauthorized: Reset Admin.Api rejected Basic Auth credentials. Re-authentication required.');
          process.exit(2);
        }
        console.error(`Failure: ${err.message}`);
        process.exit(1);
      }
    }

    // Handle mock mode
    if (options.mock) {
      const mockData = generateMockReport(options, creds);
      console.log(JSON.stringify(mockData, null, 2));
      process.exit(0);
    }

    // Step 3: Query Admin.Api (STRICTLY READ-ONLY GET)
    const apiPath = resolveApiPath(options);
    const response = await queryAdminApi(baseUrl, apiPath, creds);

    // Step 4: Handle Response & Re-Authentication on 401 / 403
    if (!response.ok) {
      if (response.authFailed || response.statusCode === 401) {
        console.error('Failure: AUTH_FAILED (HTTP 401 Unauthorized)\nThe stored Reset Basic Auth token was rejected or has expired (user credentials have changed).\nACTION_REQUIRED: Prompt the user for updated credentials and overwrite tokens everywhere using:\n  node scripts/auth.cjs update --username <user> --stdin --test');
        process.exit(2);
      }

      if (response.forbidden || response.statusCode === 403) {
        console.error('Failure: FORBIDDEN (HTTP 403 Forbidden)\nUser authenticated successfully, but lacks required role claim (Policies.ViewAgRunData) on Reset Admin.Api.\nACTION_REQUIRED: Contact Reset AGWeb administrators to request ViewAgRunData read access.');
        process.exit(3);
      }

      console.error(`Failure: AGWEB_API_ERROR (HTTP ${response.statusCode || 'N/A'})\n${response.message}`);
      process.exit(1);
    }

    // Output successful report data
    console.log(JSON.stringify(response.data || response.rawText, null, 2));
    process.exit(0);
  } catch (err) {
    console.error(`Failure: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  resolveApiPath,
  queryAdminApi,
  lookupLatestRunForCurrency,
  generateMockReport,
  assertReadOnlyPath
};
