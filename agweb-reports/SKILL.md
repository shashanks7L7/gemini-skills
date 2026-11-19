---
name: agweb-reports
description: Fetches and analyzes Reset AGWeb reporting and optimization run analytics from Admin.Api using Basic Auth on the corporate network. Use when the user requests Reset AGWeb run reports, DV01 risk reduction, trade details, confirmation status, exposure, vega changes, or limits.
---

# Reset AGWeb Reports

## Overview

Retrieve and analyze optimization run reports and analytics from the Reset `Admin.Api` backend (`https://prod.reset.osttra.xyz/prod/agweb`) over HTTP Basic Authentication (`realm="Reset"`). This skill operates strictly on the internal Osttra corporate network/VPN, stores **ONLY the Basic Auth token** in Windows User Environment Variables (never saving usernames or passwords), and is **STRICTLY READ-ONLY**.

---

## Security Guarantees

### 1. Token-Only Storage (No Passwords Saved)
- **Zero Plaintext Credentials**: Username and password are used strictly in memory to compute the HTTP Basic Auth token (`Basic <base64>`) and are **never saved to disk or system variables**.
- **User Environment Variable**: Only `AGWEB_REPORTS_BASIC_AUTH` is saved in `HKEY_CURRENT_USER\Environment`.
- **Zero Credential Files on Disk**: No vault files or password files exist in `~/.agweb-reports`.
- **Security Audit**: Run `node scripts/auth.cjs audit` at any time to verify that no credentials or passwords are saved on disk or in system variables.

### 2. Strictly Read-Only
- **HTTP Methods**: Only `GET` requests are permitted. All mutating operations (`POST`, `PUT`, `DELETE`, import, update, save, copy) are strictly forbidden and blocked in code.
- **Authorization Scope**: Restricted to read-only `Policies.ViewAgRunData`. Write/execution policies are never invoked.

---

## Workflow Decision Tree

Follow this exact sequential workflow whenever handling Reset AGWeb reporting requests:

```
[User Request (e.g. "Show DV01 reduction for USD")]
       │
       ▼
1. Verify Corporate Network (`scripts/check_network.cjs`)
       │ Checks https://prod.reset.osttra.xyz/prod/home/
       ├─► Unreachable ──► Abort with VPN connection notice
       │
       ▼
2. Check Credential Status (`scripts/auth.cjs status`)
       │
       ├─► Missing ──► Prompt user for credentials (`ask_user`)
       │               (Standard username format, e.g. s_shirol)
       │               Saves ONLY the Basic Auth token
       ▼
3. Determine Run ID or Currency
       │ If Run ID known ──► Use --run-id <runId>
       │ If Currency known ──► Auto-lookup via --currency <CCY>
       ▼
4. Fetch Report Data (`scripts/fetch_reports.cjs` - GET Only)
       │
       ├─► HTTP 401 (Auth Failed) ──► Re-prompt user (`ask_user`)
       │                              and update token (`scripts/auth.cjs set`)
       ▼
5. Run In-Depth Analysis on Optimization & Risk Data
       │
       ▼
6. Present Findings (Executive Summary, Key Risk Metrics, Trade Tables, Action Items)
```

---

## Step 1: Corporate Network Guardrail

Before querying internal reporting infrastructure, verify corporate network or VPN connectivity.

Execute:
```bash
node scripts/check_network.cjs
```

- **If Connected (Exit code 0)**: The endpoint `https://prod.reset.osttra.xyz/prod/home/` responded successfully. Proceed to Step 2.
- **If Disconnected (Exit code 1)**: Stop immediately. Inform the user:
  > *"Corporate network check failed: Reset AGWeb Reports can only be accessed while connected to the internal Osttra corporate network or VPN. Please connect to the corporate VPN and try again."*
- **Offline / Mock Mode**: Use `--mock` or `--skip-network-check` if the user wants to preview report formats offline without live network access.

---

## Step 2: Token-Only Credential Verification

Basic Auth tokens are validated against `GET /api/account/GetAuthenticatedUser` (`realm="Reset"`) and saved exclusively in Windows User Environment Variable `AGWEB_REPORTS_BASIC_AUTH`.

### Check Token Status

Execute:
```bash
node scripts/auth.cjs status
```

### If Token Is Missing (Exit code 1):
1. Prompt the user for their standard Reset LDAP credentials using `ask_user`:
   - Request standard username (e.g. `s_shirol`) and password.
2. Generate and store token:
   ```bash
   node scripts/auth.cjs set --username "<STANDARD_USERNAME>" --password "<PASSWORD>" --test
   ```
   *(Only the computed `Basic <base64>` header is saved into `AGWEB_REPORTS_BASIC_AUTH`. Username and password are not stored).*

### Run Security Audit
To verify that no usernames, passwords, or vault files exist:
```bash
node scripts/auth.cjs audit
```

---

## Step 3: Handling Re-Authentication and Credential Changes

If the user reports their credentials have changed, or if any query returns `HTTP 401 Unauthorized` (Exit code 2 from `fetch_reports.cjs`):

1. Notify the user that authentication failed or credentials have expired.
2. Prompt the user for their updated credentials using `ask_user`.
3. Update and verify the stored Basic Auth token immediately:
   ```bash
   node scripts/auth.cjs set --username "<NEW_USERNAME>" --password "<NEW_PASSWORD>" --test
   ```
4. Retry the report fetch.

To manually clear the stored token:
```bash
node scripts/auth.cjs clear
```

---

## Step 4: Run Lookup and Report Fetching (Strictly Read-Only)

### Automated Currency Run Lookup
To find the latest run ID for a currency (e.g. USD, EUR, GBP, JPY):
```bash
node scripts/fetch_reports.cjs lookup-run --currency <CCY>
```

Or pass `--currency <CCY>` directly when fetching a report—the script will automatically resolve the latest run ID:
```bash
node scripts/fetch_reports.cjs --type summary --currency USD
```

### Fetching by Specific Run ID

| Report Category | Admin.Api Action | Command Parameter |
| :--- | :--- | :--- |
| **Portfolio Summary** | `GetOptRunPortfolioSummaryReport` | `--type summary --run-id <runId>` |
| **Trade Details** | `GetOptTradeDetailsReport` | `--type trades --run-id <runId>` |
| **Trades Summary** | `GetOptTradesSummaryReport` | `--type trades-summary --run-id <runId>` |
| **Exposure Report** | `GetOptExposureReport` | `--type exposure --run-id <runId>` |
| **Daily Vega Change** | `GetOptDailyVegaChangeReport` | `--type vega --run-id <runId>` |
| **DV01 Cascade** | `GetDv01Cascade` | `--type dv01 --run-id <runId>` |
| **PnL Max Report** | `GetOptPnlMaxReport` | `--type pnl --run-id <runId>` |
| **Confirmation Status**| `GetConfirmationStatusReport` | `--type confirmation --run-id <runId>` |
| **Dealer Orders** | `GetDealerOutstandingOrdersReport`| `--type dealer-orders --run-id <runId>` |
| **Credit Limits** | `GetOptCreditLimitReport` | `--type credit --run-id <runId>` |
| **Brokerage** | `GetOptBrokerageReport` | `--type brokerage --run-id <runId>` |
| **Dealer Hedges** | `GetOptDealerHedgeDetailsReport` | `--type hedges --run-id <runId>` |
| **ISIN Code Report** | `GetIsinCodeReport` | `--type isin --run-id <runId>` |
| **Positions Report** | `GetOptPositionsReport` | `--type positions --run-id <runId>` |
| **Run Currency Info** | `GetRunCurrencyInfo` | `--type run-info --run-id <runId>` |
| **Arbitrary Read Action** | Any read controller action | `--endpoint "/api/reports/<Action>?..."` |

- See [references/config.md](references/config.md) for Kubernetes environment routing and Swagger documentation URLs.
- See [references/api_reference.md](references/api_reference.md) for endpoint specifications and parameter schemas.

### Automated Swagger Reference Updater
To synchronize reporting endpoint schemas and query parameters directly from live Swagger UI documentation:
```bash
# Update from Production Swagger (https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html)
node scripts/update_api_reference.cjs --env prod

# Or update from PATCH / Test Swagger (https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html)
node scripts/update_api_reference.cjs --env patch

# Or via fetch_reports helper
node scripts/fetch_reports.cjs update-ref --env prod
```
*(Strict guardrail: Only GET endpoints under `/api/reports/` are fetched; all mutating and non-reporting endpoints are excluded).*

---

## Step 5: Run In-Depth Analysis on Optimization & Risk Data

Synthesize the returned JSON data according to the user's query. Never dump raw JSON payloads unless requested. Format your analysis as follows:

### 1. Executive Summary
- Run ID, Currency, Run Status, and Total Portfolios Enrolled.
- Core Optimization Outcome (e.g. Total DV01 reduction %, Gross proposed trades, PnL impact).

### 2. Key Metrics & Risk Breakdown
Format risk reduction and trade activity in clean markdown tables:
| Metric | Pre-Optimization | Post-Optimization | Delta / Reduction % | Status |
| :--- | :--- | :--- | :--- | :--- |

### 3. Top Portfolio & Dealer Highlights
- Highlight portfolios with the largest risk reduction or largest trade volume.
- Highlight any portfolios with minimal reduction or anomalous hedge ratios.

### 4. Exceptions, Alerts & Warnings
- Highlight any limit breaches, ISIN mapping errors, or outstanding unconfirmed dealer orders.
- Provide clear operational recommendations for operations or risk managers.
