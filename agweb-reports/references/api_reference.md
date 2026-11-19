# Reset Admin.Api Reporting Endpoints Reference

This reference documents the API endpoints, query parameters, and response structures exposed by the Reset `Admin.Api` backend.

> **Auto-Updated Reference**: Synchronized from Reset Admin.Api Swagger UI specifications for PATCH and PROD.
> - **Source Swagger UI (PROD)**: [https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html](https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html)
> - **Source Swagger UI (PATCH)**: [https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html](https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html)
> - **Last Synchronized**: 2026-11-19
> - **Total Report GET Endpoints**: 38

---

## Security Mandate: STRICTLY READ-ONLY

This skill is designed with strict read-only guardrails:
- **HTTP Methods**: Only `GET` requests are allowed. All `POST`, `PUT`, `DELETE`, and mutating operations are forbidden and blocked by code.
- **Authorization Policy**: Queries require `Policies.ViewAgRunData`. No write or execution policies (`EditAgRunData`, `EditRunSchedule`) are invoked.
- **LDAP Username Format**: Standard corporate username format (e.g. `s_shirol`, without domain prefix) is enforced.

---

## Base URL and Routing

- **Production Base URL**: `https://prod.reset.osttra.xyz/prod/agweb`
- **PATCH (Test) Base URL**: `https://dev.reset.osttra.xyz/patch/agweb`
- **Swagger Documentation**: `https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html` (PROD) & `https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html` (PATCH)
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

All report endpoints below are strictly **`GET`** requests. Only reporting endpoints are documented here; all mutating and non-reporting endpoints are excluded.

| Action Name | Parameter(s) | Description |
| :--- | :--- | :--- |
| `GetClearPortDealerDetails` | `dealerIds?: List<int>` | ClearPort clearing dealer details and account parameters |
| `GetClientClearingTradeReport` | `runId?: int` | Client clearing trade report (clearing trade allocations per client entity) |
| `GetConfirmationStatusReport` | `runIds?: List<int>` | Confirmation status across optimization runs |
| `GetConfirmationStatusSummary` | `runIds?: List<int>` | Aggregated confirmation status summary |
| `GetDealerCurrenciesDetails` | `dealerIds?: List<int>` | Configured currency pairs and active currencies per dealer |
| `GetDealerHistory` | `dealerIds?: List<int>, fromDate?: DateTime, toDate?: DateTime` | Historical dealer participation, trade volume, and configuration audit log |
| `GetDealerOutstandingOrdersReport` | `runIds?: List<int>` | Outstanding orders pending dealer confirmation |
| `GetDealerSummaryRows` | `dealerIds?: List<int>` | Comprehensive dealer overview and setup status |
| `GetDv01Cascade` | `runId?: int` | DV01 cascade waterfall reduction across run phases |
| `GetDv01Report` | `runId?: int, portfolioId?: int` | Portfolio-specific DV01 report |
| `GetFxbaDealerDetails` | `dealerIds?: List<int>` | FXBA (FX Brokerage Association) dealer details and setup |
| `GetIsinCodeReport` | `runId?: int` | ISIN code mapping and instrument validation report |
| `GetLegalEntityWarnings` | `None` | System-wide legal entity warning alerts |
| `GetMarkitWireDealerDetails` | `dealerIds?: List<int>` | MarkitWire routing, clearing IDs, and dealer connection parameters |
| `GetOptBrokerageReport` | `runId?: int` | Brokerage fee breakdown for the run |
| `GetOptCreditLimitReport` | `runId?: int` | Dealer and bilateral credit limit utilization |
| `GetOptDailyVegaChangeReport` | `runId?: int` | Daily Vega change breakdown by portfolio and maturity bucket |
| `GetOptDealerHedgeDetailsReport` | `runId?: int` | Dealer hedge details and execution breakdown |
| `GetOptDiscreteLadderReport` | `runId?: int, executionNumber?: int` | Discrete ladder optimization stages and iterations |
| `GetOptEnrolledPortfolioDetails` | `runId?: int` | Enrolled portfolio details and participation parameters for the run |
| `GetOptExposureReport` | `runId?: int` | Portfolio exposure results (initial vs final exposure) |
| `GetOptGammaRawData` | `runId?: int` | Raw Gamma bucket data for nonlinear risk optimization |
| `GetOptHeatmapTargetDistributionReport` | `runId?: int` | Heatmap target distribution across tenor buckets |
| `GetOptLimitsReport` | `runId?: int, limitPurpose?: LimitPurpose (Current | Saved | RunTemplate | DealerTemplate)` | Limit utilization vs configured risk curves (Current, Saved, RunTemplate, DealerTemplate) |
| `GetOptPnlMaxReport` | `runId?: int` | Maximum PnL impact report across participating portfolios |
| `GetOptPositionsGraphicalReport` | `runId?: int` | Graphical / visual position distribution data for portfolios |
| `GetOptPositionsMetadata` | `None` | Metadata schema and field definitions for optimization positions |
| `GetOptPositionsReport` | `runId?: int, metric?: OptPositionsMetrics (Lots | Gamma | Vega)` | Net positions per portfolio by metric (Lots, Gamma, Vega) |
| `GetOptRunPortfolioSummaryReport` | `runId?: int` | Portfolio summary for an optimization run (DV01 reductions, proposed trades, dealer counts) |
| `GetOptTradeDetailsReport` | `runId?: int` | Detailed trade-by-trade breakdown of proposed optimization trades |
| `GetOptTradesSummaryReport` | `runId?: int` | High-level aggregated summary of trades across participating entities |
| `GetOptVolReport` | `runId?: int, strikeStep?: decimal` | Volatility surface and strike report |
| `GetOpvRunExecutionDealerReport` | `runId?: int, runPortfolioId?: int` | OPV run execution dealer report (dealer execution metrics for OPV runs) |
| `GetOpvRunTradeReport` | `runId?: int, runPortfolioId?: int` | OPV run trade report (detailed trade breakdown for OPV optimization runs) |
| `GetPortfolioSetupDetails` | `dealerIds?: List<int>` | Detailed portfolio configuration, ownership, and risk constraints |
| `GetReutersCodes` | `runId?: int, excludeClosedBanks?: bool` | Reuters codes mapping for clearing and trade booking |
| `GetRtnsDealerDetails` | `dealerIds?: List<int>` | RTNS (Reuters Trade Notification Service) dealer configuration and details |
| `GetSefTraderMapping` | `runId?: int` | SEF trader to account mapping table |

---

## Run Endpoints (`/api/run/`)

### `GetRunCurrencyInfo`
- **Method**: `GET` (Read-only)
- **Route**: `/api/run/GetRunCurrencyInfo?runId={runId}`
- **Description**: Returns base currency, valuation date, settlement date, and currency parameters for the specified optimization run.

---

## Automated Reference Update Procedure

To re-sync this reference against live Swagger UI / OpenAPI documentation:

```bash
# Update from Production Swagger
node scripts/update_api_reference.cjs --env prod

# Or update from PATCH (Test) Swagger
node scripts/update_api_reference.cjs --env patch
```
