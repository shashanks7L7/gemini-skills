# Reset Admin.Api Reporting Endpoints Reference

This reference documents the API endpoints, query parameters, and response structures exposed by the Reset `Admin.Api` backend.

## Security Mandate: STRICTLY READ-ONLY

This skill is designed with strict read-only guardrails:
- **HTTP Methods**: Only `GET` requests are allowed. All `POST`, `PUT`, `DELETE`, and mutating operations are forbidden and blocked by code.
- **Authorization Policy**: Queries require `Policies.ViewAgRunData`. No write or execution policies (`EditAgRunData`, `EditRunSchedule`) are invoked.
- **LDAP Username Format**: Standard corporate username format (e.g. `s_shirol`, without domain prefix) is enforced.

---

## Base URL and Routing

- **Production Base URL**: `https://prod.reset.osttra.xyz/prod/agweb`
- **Route Prefix**: `/api/reports/[action]`, `/api/account/[action]`, `/api/run/[action]`, `/api/v1/RunOrchestration/[action]`
- **Authentication**: HTTP Basic Auth (`realm="Reset"`), passing standard `Authorization: Basic <base64(standard_user:password)>`
- **Response Format**: `GenericResponse<T>` containing `{ "success": boolean, "data": T, "message": string }`

---

## Automated Run Lookup Helper (`/api/v1/RunOrchestration/GetRuns`)

To discover runs or find the latest active run ID for a specific currency:

### `lookup-run` Helper
- **Method**: `GET`
- **Route**: `/api/v1/RunOrchestration/GetRuns?maxRunCount=100`
- **Helper Usage**:
  ```bash
  node scripts/fetch_reports.cjs lookup-run --currency <USD|EUR|GBP|JPY|...>
  ```
- **Returns**:
  ```json
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
  ```
- **Automatic Resolution**: If `--currency <CCY>` is provided without `--run-id`, the script automatically fetches the latest run ID for that currency before retrieving the report:
  ```bash
  node scripts/fetch_reports.cjs --type summary --currency USD
  ```

---

## Account Endpoints (`/api/account/`)

### `GetAuthenticatedUser`
- **Method**: `GET` (Read-only)
- **Route**: `/api/account/GetAuthenticatedUser`
- **Description**: Returns the authenticated user's model (`UserModel`), including username, email, full name, employee ID, and assigned role claims.
- **Used by Skill**: Empirically verifies whether stored Basic Auth credentials are valid. Returns HTTP 401 when invalid.

---

## Report Endpoints (`/api/reports/`)

All report endpoints accept `runId` (or `runIds` for multi-run queries). All are strictly `GET` requests:

| Action Name | Parameter(s) | Description |
| :--- | :--- | :--- |
| `GetOptRunPortfolioSummaryReport` | `runId: int` | Portfolio summary for an optimization run (DV01 reductions, proposed trades, dealer counts) |
| `GetOptTradeDetailsReport` | `runId: int` | Detailed trade-by-trade breakdown of proposed optimization trades |
| `GetOptTradesSummaryReport` | `runId: int` | High-level aggregated summary of trades across participating entities |
| `GetOptExposureReport` | `runId: int` | Portfolio exposure results (initial vs final exposure) |
| `GetOptDailyVegaChangeReport` | `runId: int` | Daily Vega change breakdown by portfolio and maturity bucket |
| `GetOptVolReport` | `runId: int, strikeStep?: decimal` | Volatility surface and strike report |
| `GetOptPnlMaxReport` | `runId: int` | Maximum PnL impact report across participating portfolios |
| `GetConfirmationStatusReport` | `runIds: List<int>` | Confirmation status across optimization runs |
| `GetConfirmationStatusSummary` | `runIds: List<int>` | Aggregated confirmation status summary |
| `GetDealerOutstandingOrdersReport` | `runIds: List<int>` | Outstanding orders pending dealer confirmation |
| `GetOptGammaRawData` | `runId: int` | Raw Gamma bucket data for nonlinear risk optimization |
| `GetOptCreditLimitReport` | `runId: int` | Dealer and bilateral credit limit utilization |
| `GetOptBrokerageReport` | `runId: int` | Brokerage fee breakdown for the run |
| `GetOptDealerHedgeDetailsReport` | `runId: int` | Dealer hedge details and execution breakdown |
| `GetIsinCodeReport` | `runId: int` | ISIN code mapping and instrument validation report |
| `GetOptPositionsReport` | `runId: int, metric: int` | Net positions per portfolio |
| `GetOptLimitsReport` | `runId: int, limitPurpose: int` | Limit utilization vs configured risk curves |
| `GetDealerSummaryRows` | `dealerIds?: List<int>` | Comprehensive dealer overview and setup status |
| `GetDv01Cascade` | `runId: int` | DV01 cascade waterfall reduction across run phases |
| `GetDv01Report` | `runId: int, portfolioId: int` | Portfolio-specific DV01 report |
| `GetOptDiscreteLadderReport` | `runId: int, executionNumber?: int` | Discrete ladder optimization stages and iterations |
| `GetLegalEntityWarnings` | None | System-wide legal entity warning alerts |
| `GetReutersCodes` | `runId?: int, excludeClosedBanks?: bool` | Reuters codes mapping for clearing and trade booking |
| `GetSefTraderMapping` | `runId?: int` | SEF trader to account mapping table |
| `GetOptHeatmapTargetDistributionReport`| `runId: int` | Heatmap target distribution across tenor buckets |

---

## Run Endpoints (`/api/run/`)

### `GetRunCurrencyInfo`
- **Method**: `GET` (Read-only)
- **Route**: `/api/run/GetRunCurrencyInfo?runId={runId}`
- **Description**: Returns base currency, valuation date, settlement date, and currency parameters for the specified optimization run.
