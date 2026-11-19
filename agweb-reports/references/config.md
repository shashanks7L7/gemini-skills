# Configuration and Environment Reference

This document describes how the `agweb-reports` skill connects to the Reset Admin.Api reporting backend and verifies corporate network connectivity.

## Infrastructure and Default Endpoints

The skill is pre-configured to communicate directly with the Reset Admin.Api backend deployed via Kubernetes on the Osttra corporate network:

| Component | Default Production Value | Environment Variable Override |
| :--- | :--- | :--- |
| **Network Verification URL** | `https://prod.reset.osttra.xyz/prod/home/` | `AGWEB_REPORTS_NETWORK_URL` |
| **Admin.Api Backend Base URL** | `https://prod.reset.osttra.xyz/prod/agweb` | `AGWEB_REPORTS_URL` |
| **Authentication Challenge** | HTTP Basic Auth (`realm="Reset"`) | N/A |
| **Auth Verification Endpoint** | `/api/account/GetAuthenticatedUser` | N/A |
| **Health Check Endpoint** | `/health` (returns HTTP 200) | N/A |
| **Basic Auth Header** | Windows User Env (`AGWEB_REPORTS_BASIC_AUTH`) | `AGWEB_REPORTS_BASIC_AUTH` |

---

## Token-Only Credential Storage & Security

To ensure maximum security, transparency, and credential isolation:
1. **No Plaintext Password Files on Disk**:
   - The user's plaintext password is **never saved to disk files, vaults, or configuration files**.
   - Credentials entered during authentication are used strictly in memory to compute the standard HTTP Basic Auth header token (`Basic <base64(user:pass)>`), after which raw credentials are discarded.

2. **Windows User Environment Variable & Security Transparency**:
   - Only the computed Basic Auth header token is saved in the Windows User Environment Variable:
     ```
     AGWEB_REPORTS_BASIC_AUTH = "Basic <base64>"
     ```
   - This variable is stored in the Windows User registry hive (`HKEY_CURRENT_USER\Environment`), accessible exclusively by your logged-in Windows user account.
   - **Security Transparency Notice**: Base64 is an encoding, not an encryption cipher. Any process running under your logged-in Windows user session can decode this environment variable. For strict isolation, avoid running untrusted scripts in the same Windows user session.
   - **Zero CLI Password Exposure**: Passwords should never be supplied as CLI arguments (which would be logged in Windows Security Event 4688 / Sysmon Event 1). Passwords are provided via standard input stream (`--stdin`) or interactive prompt.

3. **Security Audit Command**:
   - You can audit the system at any time to verify that no username or password is stored in plaintext:
     ```bash
     node scripts/auth.cjs audit
     ```
   - Confirms that `AGWEB_REPORTS_USER` is empty, `AGWEB_REPORTS_PASS` is empty, and no credential files exist on disk.

4. **Re-Authentication and Token Overwrite Flow**:
   - If user credentials change, or if Admin.Api returns `HTTP 401 Unauthorized` (`realm="Reset"`):
     1. Prompt for updated standard LDAP username and new password via `ask_user`.
     2. Execute securely via stdin pipe:
        ```bash
        "$NEW_PASSWORD" | node scripts/auth.cjs update --username "<STANDARD_USER>" --stdin --test
        ```
     3. This purges old tokens everywhere (User Registry, Process environment, and local config caches), computes and saves the fresh Basic Auth token to `AGWEB_REPORTS_BASIC_AUTH`, and immediately verifies against `/api/account/GetAuthenticatedUser`.
     4. If the user lacks `Policies.ViewAgRunData`, Admin.Api returns HTTP 403 Forbidden (Exit code 3). Contact AGWeb administrators to request read access.

---

## Kubernetes Ingress and Environments

The reporting site (`Admin.Api` backend and `ReactWeb` frontend) is deployed via Helm/Kubernetes manifests in `.devrun/kubernetes` with ingress routing configured on shared hosts:

- **Host**: `prod.reset.osttra.xyz` (for prod instances) and `dev.reset.osttra.xyz` (for PATCH, UAT, and QA instances)
- **Path Base**: `/{environment}/agweb` (e.g. `/prod/agweb`, `/patch/agweb`)
- **Supported Environments**:
  - `PROD`: `https://prod.reset.osttra.xyz/prod/agweb` (default)
  - `PATCH`: `https://dev.reset.osttra.xyz/patch/agweb` (Test / UAT)
  - `QA`: `https://dev.reset.osttra.xyz/qa/agweb`
  - `UAT`: `https://dev.reset.osttra.xyz/uat/agweb`

### Swagger UI Documentation Endpoints

Live OpenAPI 3.0 / Swagger UI documentation is available for inspecting API schemas:
- **PROD Swagger UI**: `https://prod.reset.osttra.xyz/prod/agweb/swagger/index.html`
  - **OpenAPI JSON**: `/prod/agweb/open-api-documentation/v1/docs.json`
- **PATCH Swagger UI**: `https://dev.reset.osttra.xyz/patch/agweb/swagger/index.html`
  - **OpenAPI JSON**: `/patch/agweb/open-api-documentation/v1/docs.json`

To automatically re-sync `references/api_reference.md` from Swagger (strictly filtering for GET report endpoints):
```bash
node scripts/update_api_reference.cjs --env prod
# or
node scripts/update_api_reference.cjs --env patch
```

### Switching Environments

To target a different environment, set `AGWEB_REPORTS_URL`:
```powershell
# Target PATCH
[System.Environment]::SetEnvironmentVariable('AGWEB_REPORTS_URL', 'https://dev.reset.osttra.xyz/patch/agweb', 'User')

# Or in current terminal session:
$env:AGWEB_REPORTS_URL = "https://dev.reset.osttra.xyz/patch/agweb"
```

---

## Internal Corporate Network Guardrail

The skill will verify corporate network or VPN connectivity before making any queries.

- **Check Method**: Probes `https://prod.reset.osttra.xyz/prod/home/`. On the internal Osttra corporate network, this endpoint responds immediately (e.g. HTTP 200, 302, or 401 Basic Challenge).
- **If Disconnected**: Execution halts with a clear prompt to connect to the corporate VPN.
- **Offline / Mock Mode**: Use `--mock` or `--skip-network-check` for testing report templates offline.
