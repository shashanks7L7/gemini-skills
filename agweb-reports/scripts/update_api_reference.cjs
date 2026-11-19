#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Automated Reporting API Reference Updater for Reset AGWeb Reports
 *
 * Connected to Admin.Api Swagger UI / OpenAPI 3.0 Documentation:
 * - PROD:  https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html
 * - PATCH: https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html
 *
 * Strict Guardrails:
 * 1. STRICTLY REPORTS ONLY: Only endpoints for reports (/api/reports/ or tag 'Report') are fetched.
 * 2. STRICTLY GET ONLY: All non-GET methods (POST, PUT, DELETE, etc.) are strictly excluded.
 * 3. NO THIRD-PARTY DEPENDENCIES: Uses standard Node.js libraries (https, fs, path).
 *
 * Usage:
 *   node scripts/update_api_reference.cjs [--env prod|patch|both] [--check]
 */

const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');

// Swagger environments
const SWAGGER_CONFIGS = {
  prod: {
    env: 'prod',
    name: 'PROD (Production)',
    baseUrl: 'https://prod.reset.osttra.xyz/prod/agweb',
    swaggerUiUrl: 'https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html',
    docsFallback: 'https://prod.reset.osttra.xyz/prod/agweb/open-api-documentation/v1/docs.json'
  },
  patch: {
    env: 'patch',
    name: 'PATCH (Test / UAT)',
    baseUrl: 'https://dev.reset.osttra.xyz/patch/agweb',
    swaggerUiUrl: 'https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html',
    docsFallback: 'https://dev.reset.osttra.xyz/patch/agweb/open-api-documentation/v1/docs.json'
  }
};

const DEFAULT_REFERENCE_FILE = path.resolve(__dirname, '..', 'references', 'api_reference.md');

// Curated domain descriptions for Report actions
const REPORT_DESCRIPTIONS = {
  GetOptRunPortfolioSummaryReport: 'Portfolio summary for an optimization run (DV01 reductions, proposed trades, dealer counts)',
  GetOptTradeDetailsReport: 'Detailed trade-by-trade breakdown of proposed optimization trades',
  GetOptTradesSummaryReport: 'High-level aggregated summary of trades across participating entities',
  GetOptExposureReport: 'Portfolio exposure results (initial vs final exposure)',
  GetOptDailyVegaChangeReport: 'Daily Vega change breakdown by portfolio and maturity bucket',
  GetOptVolReport: 'Volatility surface and strike report',
  GetOptPnlMaxReport: 'Maximum PnL impact report across participating portfolios',
  GetConfirmationStatusReport: 'Confirmation status across optimization runs',
  GetConfirmationStatusSummary: 'Aggregated confirmation status summary',
  GetDealerOutstandingOrdersReport: 'Outstanding orders pending dealer confirmation',
  GetOptGammaRawData: 'Raw Gamma bucket data for nonlinear risk optimization',
  GetOptCreditLimitReport: 'Dealer and bilateral credit limit utilization',
  GetOptBrokerageReport: 'Brokerage fee breakdown for the run',
  GetOptDealerHedgeDetailsReport: 'Dealer hedge details and execution breakdown',
  GetIsinCodeReport: 'ISIN code mapping and instrument validation report',
  GetOptPositionsReport: 'Net positions per portfolio by metric (Lots, Gamma, Vega)',
  GetOptLimitsReport: 'Limit utilization vs configured risk curves (Current, Saved, RunTemplate, DealerTemplate)',
  GetDealerSummaryRows: 'Comprehensive dealer overview and setup status',
  GetDv01Cascade: 'DV01 cascade waterfall reduction across run phases',
  GetDv01Report: 'Portfolio-specific DV01 report',
  GetOptDiscreteLadderReport: 'Discrete ladder optimization stages and iterations',
  GetLegalEntityWarnings: 'System-wide legal entity warning alerts',
  GetReutersCodes: 'Reuters codes mapping for clearing and trade booking',
  GetSefTraderMapping: 'SEF trader to account mapping table',
  GetOptHeatmapTargetDistributionReport: 'Heatmap target distribution across tenor buckets',
  GetOpvRunExecutionDealerReport: 'OPV run execution dealer report (dealer execution metrics for OPV runs)',
  GetClientClearingTradeReport: 'Client clearing trade report (clearing trade allocations per client entity)',
  GetOpvRunTradeReport: 'OPV run trade report (detailed trade breakdown for OPV optimization runs)',
  GetOptEnrolledPortfolioDetails: 'Enrolled portfolio details and participation parameters for the run',
  GetOptPositionsMetadata: 'Metadata schema and field definitions for optimization positions',
  GetOptPositionsGraphicalReport: 'Graphical / visual position distribution data for portfolios',
  GetDealerCurrenciesDetails: 'Configured currency pairs and active currencies per dealer',
  GetMarkitWireDealerDetails: 'MarkitWire routing, clearing IDs, and dealer connection parameters',
  GetRtnsDealerDetails: 'RTNS (Reuters Trade Notification Service) dealer configuration and details',
  GetFxbaDealerDetails: 'FXBA (FX Brokerage Association) dealer details and setup',
  GetClearPortDealerDetails: 'ClearPort clearing dealer details and account parameters',
  GetPortfolioSetupDetails: 'Detailed portfolio configuration, ownership, and risk constraints',
  GetDealerHistory: 'Historical dealer participation, trade volume, and configuration audit log'
};

/**
 * Fetches content from an HTTPS URL with timeout.
 */
function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const req = https.get(
        {
          hostname: parsed.hostname,
          port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          headers: {
            'User-Agent': 'agweb-reports-skill/1.0',
            Accept: '*/*'
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
            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body
            });
          });
        }
      );

      req.on('error', (err) => reject(new Error(`Network error requesting ${url}: ${err.message}`)));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Timeout requesting ${url}`));
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Discovers the OpenAPI / Swagger docs.json URL from Swagger UI index.html
 */
async function discoverSwaggerDocsUrl(swaggerUiUrl, fallbackUrl) {
  try {
    const res = await fetchHttps(swaggerUiUrl);
    if (res.statusCode >= 200 && res.statusCode < 300) {
      // Find URLs config in Swagger UI HTML
      // e.g.: configObject = JSON.parse('{"urls":[{"url":"/prod/agweb/open-api-documentation/v1/docs.json",...
      const match = res.body.match(/"urls"\s*:\s*\[\s*\{\s*"url"\s*:\s*"([^"]+)"/);
      if (match && match[1]) {
        const rawUrl = match[1];
        if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
          return rawUrl;
        }
        const parsedBase = new URL(swaggerUiUrl);
        return `${parsedBase.origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
      }
    }
  } catch (_) {
    // Fall back to known endpoint
  }
  return fallbackUrl;
}

/**
 * Parses and formats OpenAPI query parameters.
 */
function formatParameters(parameters, components) {
  if (!Array.isArray(parameters)) return 'None';

  // Strictly filter out internal headers (like x-traceid) and cookies
  const relevant = parameters.filter((p) => p.in === 'query' || p.in === 'path');
  if (relevant.length === 0) return 'None';

  return relevant
    .map((p) => {
      let typeStr = 'any';
      if (p.schema) {
        if (p.schema['$ref']) {
          const refName = p.schema['$ref'].split('/').pop();
          const shortName = refName.split('.').pop();
          // Check if it's an enum in components
          if (components && components.schemas && components.schemas[refName] && components.schemas[refName].enum) {
            const enumValues = components.schemas[refName].enum.join(' | ');
            typeStr = `${shortName} (${enumValues})`;
          } else {
            typeStr = shortName;
          }
        } else if (p.schema.type === 'array') {
          let itemType = 'int';
          if (p.schema.items) {
            if (p.schema.items['$ref']) {
              itemType = p.schema.items['$ref'].split('/').pop().split('.').pop();
            } else if (p.schema.items.format === 'int32' || p.schema.items.type === 'integer') {
              itemType = 'int';
            } else if (p.schema.items.type) {
              itemType = p.schema.items.type;
            }
          }
          typeStr = `List<${itemType}>`;
        } else if (p.schema.type === 'integer') {
          typeStr = p.schema.format === 'int64' ? 'long' : 'int';
        } else if (p.schema.type === 'number') {
          typeStr = 'decimal';
        } else if (p.schema.type === 'boolean') {
          typeStr = 'bool';
        } else if (p.schema.type === 'string') {
          typeStr = p.schema.format === 'date-time' ? 'DateTime' : 'string';
        }
      }

      const optionalFlag = p.required ? '' : '?';
      return `${p.name}${optionalFlag}: ${typeStr}`;
    })
    .join(', ');
}

/**
 * Fetches and extracts report GET endpoints from an environment's Swagger specification.
 *
 * Strict Guardrails:
 * - Endpoints MUST belong to /api/reports/ or have tag 'Report'
 * - Method MUST be strictly 'GET'
 */
async function fetchReportEndpointsFromSwagger(envKey) {
  const config = SWAGGER_CONFIGS[envKey] || SWAGGER_CONFIGS.prod;
  const docsUrl = await discoverSwaggerDocsUrl(config.swaggerUiUrl, config.docsFallback);

  const res = await fetchHttps(docsUrl);
  if (res.statusCode !== 200) {
    throw new Error(`Failed to fetch OpenAPI JSON from ${docsUrl}: HTTP ${res.statusCode}`);
  }

  const spec = JSON.parse(res.body);
  const paths = spec.paths || {};
  const components = spec.components || {};
  const reportEndpoints = [];

  for (const [pathKey, methods] of Object.entries(paths)) {
    const isReportPath = pathKey.toLowerCase().startsWith('/api/reports/');
    const hasReportTag = Object.values(methods).some(
      (op) => Array.isArray(op.tags) && op.tags.some((t) => t.toLowerCase() === 'report')
    );

    // STRICT CHECK 1: Must be reports controller endpoint only
    if (!isReportPath && !hasReportTag) {
      continue;
    }

    for (const [method, op] of Object.entries(methods)) {
      // STRICT CHECK 2: Must be GET method only!
      if (method.toLowerCase() !== 'get') {
        continue;
      }

      // Extract proper PascalCase action name from operationId (e.g. ReportGetOptRunPortfolioSummaryReport -> GetOptRunPortfolioSummaryReport)
      let actionName = '';
      if (op.operationId) {
        actionName = op.operationId.replace(/^Report/i, '');
      }
      if (!actionName) {
        const seg = pathKey.split('/').filter(Boolean).pop();
        actionName = seg.charAt(0).toUpperCase() + seg.slice(1);
      }

      const parameters = formatParameters(op.parameters, components);
      const description = op.description || op.summary || REPORT_DESCRIPTIONS[actionName] || `${actionName} report data`;

      reportEndpoints.push({
        actionName,
        path: pathKey,
        method: 'GET',
        parameters,
        description,
        summary: op.summary || '',
        operationId: op.operationId || ''
      });
    }
  }

  // Sort alphabetically by action name
  reportEndpoints.sort((a, b) => a.actionName.localeCompare(b.actionName));

  return {
    env: config.env,
    name: config.name,
    swaggerUiUrl: config.swaggerUiUrl,
    docsUrl,
    openApiVersion: spec.openapi || spec.swagger || '3.0.1',
    endpoints: reportEndpoints
  };
}

/**
 * Generates the updated Markdown content for api_reference.md
 */
function buildApiReferenceMarkdown(reportData) {
  const timestamp = new Date().toISOString().split('T')[0];

  const tableRows = reportData.endpoints.map((ep) => {
    return `| \`${ep.actionName}\` | \`${ep.parameters}\` | ${ep.description} |`;
  });

  return `# Reset Admin.Api Reporting Endpoints Reference

This reference documents the API endpoints, query parameters, and response structures exposed by the Reset \`Admin.Api\` backend.

> **Auto-Updated Reference**: Synchronized from Reset Admin.Api Swagger UI specifications for PATCH and PROD.
> - **Source Swagger UI (PROD)**: [https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html](https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html)
> - **Source Swagger UI (PATCH)**: [https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html](https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html)
> - **Last Synchronized**: ${timestamp}
> - **Total Report GET Endpoints**: ${reportData.endpoints.length}

---

## Security Mandate: STRICTLY READ-ONLY

This skill is designed with strict read-only guardrails:
- **HTTP Methods**: Only \`GET\` requests are allowed. All \`POST\`, \`PUT\`, \`DELETE\`, and mutating operations are forbidden and blocked by code.
- **Authorization Policy**: Queries require \`Policies.ViewAgRunData\`. No write or execution policies (\`EditAgRunData\`, \`EditRunSchedule\`) are invoked.
- **LDAP Username Format**: Standard corporate username format (e.g. \`s_shirol\`, without domain prefix) is enforced.

---

## Base URL and Routing

- **Production Base URL**: \`https://prod.reset.osttra.xyz/prod/agweb\`
- **PATCH (Test) Base URL**: \`https://dev.reset.osttra.xyz/patch/agweb\`
- **Swagger Documentation**: \`https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html\` (PROD) & \`https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html\` (PATCH)
- **Route Prefix**: \`/api/reports/[action]\`, \`/api/account/[action]\`, \`/api/run/[action]\`, \`/api/v1/RunOrchestration/[action]\`
- **Authentication**: HTTP Basic Auth (\`realm="Reset"\`), passing standard \`Authorization: Basic <base64(standard_user:password)>\`
- **Response Format**: \`GenericResponse<T>\` containing \`{ "success": boolean, "data": T, "message": string }\`

---

## Automated Run Lookup Helper (\`/api/v1/RunOrchestration/GetRuns\`)

To discover runs or find the latest active run ID for a specific currency:

### \`lookup-run\` Helper
- **Method**: \`GET\`
- **Route**: \`/api/v1/RunOrchestration/GetRuns?maxRunCount=100\`
- **Helper Usage**:
  \`\`\`bash
  node scripts/fetch_reports.cjs lookup-run --currency <USD|EUR|GBP|JPY|...>
  \`\`\`
- **Returns**:
  \`\`\`json
  {
    "runId": 104820,
    "status": "Completed",
    "productId": 1,
    "product": "IRS",
    "currencyId": 1,
    "currency": "USD",
    "tradeDate": "2026-11-17T00:00:00Z",
    "titleDate": "2026-11-17T00:00:00Z",
    "portalStatus": "Approved"
  }
  \`\`\`
- **Automatic Resolution**: If \`--currency <CCY>\` is provided without \`--run-id\`, the script automatically fetches the latest run ID for that currency before retrieving the report:
  \`\`\`bash
  node scripts/fetch_reports.cjs --type summary --currency USD
  \`\`\`

---

## Account Endpoints (\`/api/account/\`)

### \`GetAuthenticatedUser\`
- **Method**: \`GET\` (Read-only)
- **Route**: \`/api/account/GetAuthenticatedUser\`
- **Description**: Returns the authenticated user's model (\`UserModel\`), including username, email, full name, employee ID, and assigned role claims.
- **Used by Skill**: Empirically verifies whether stored Basic Auth credentials are valid. Returns HTTP 401 when invalid.

---

## Report Endpoints (\`/api/reports/\`)

All report endpoints below are strictly **\`GET\`** requests. Only reporting endpoints are documented here; all mutating and non-reporting endpoints are excluded.

| Action Name | Parameter(s) | Description |
| :--- | :--- | :--- |
${tableRows.join('\n')}

---

## Run Endpoints (\`/api/run/\`)

### \`GetRunCurrencyInfo\`
- **Method**: \`GET\` (Read-only)
- **Route**: \`/api/run/GetRunCurrencyInfo?runId={runId}\`
- **Description**: Returns base currency, valuation date, settlement date, and currency parameters for the specified optimization run.

---

## Automated Reference Update Procedure

To re-sync this reference against live Swagger UI / OpenAPI documentation:

\`\`\`bash
# Update from Production Swagger
node scripts/update_api_reference.cjs --env prod

# Or update from PATCH (Test) Swagger
node scripts/update_api_reference.cjs --env patch
\`\`\`
`;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    env: 'prod',
    check: false,
    json: false,
    output: DEFAULT_REFERENCE_FILE
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--env' || arg === '-e') && args[i + 1]) {
      options.env = args[++i].toLowerCase();
    } else if (arg === '--check') {
      options.check = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = path.resolve(args[++i]);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();

  try {
    process.stderr.write(`Notice: Querying Swagger documentation for environment '${options.env.toUpperCase()}'...\n`);

    const reportData = await fetchReportEndpointsFromSwagger(options.env);
    process.stderr.write(`Notice: Discovered ${reportData.endpoints.length} strictly GET report endpoints.\n`);

    if (options.json) {
      console.log(JSON.stringify(reportData, null, 2));
      process.exit(0);
    }

    const newMarkdown = buildApiReferenceMarkdown(reportData);

    if (options.check) {
      if (fs.existsSync(options.output)) {
        const existing = fs.readFileSync(options.output, 'utf8');
        // Compare excluding timestamp line
        const stripTs = (txt) => txt.replace(/Last Synchronized:\s*\d{4}-\d{2}-\d{2}/g, '');
        if (stripTs(existing) === stripTs(newMarkdown)) {
          console.log(`Success: Reference file '${options.output}' is up to date.`);
          process.exit(0);
        } else {
          console.log(`Warning: Reference file '${options.output}' is outdated.`);
          process.exit(1);
        }
      } else {
        console.log(`Warning: Reference file '${options.output}' does not exist.`);
        process.exit(1);
      }
    }

    // Write updated markdown to file
    fs.writeFileSync(options.output, newMarkdown, 'utf8');
    console.log(`Success: Automatically updated '${options.output}' with ${reportData.endpoints.length} GET report endpoints from ${reportData.name}.`);
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
  fetchReportEndpointsFromSwagger,
  buildApiReferenceMarkdown,
  SWAGGER_CONFIGS,
  REPORT_DESCRIPTIONS
};
