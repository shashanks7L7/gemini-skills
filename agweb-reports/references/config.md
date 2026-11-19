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

To ensure maximum security and privacy:
1. **No Username or Password Storage**:
   - The user's username and password are **never saved to disk or system variables**.
   - Credentials entered during authentication are used strictly in memory to compute the standard HTTP Basic Auth header token (`Basic <base64(user:pass)>`), after which the raw credentials are discarded.

2. **Windows User Environment Variable**:
   - Only the computed Basic Auth header token is saved in the Windows User Environment Variable:
     ```
     AGWEB_REPORTS_BASIC_AUTH = "Basic <base64>"
     ```
   - This variable is stored in the Windows User registry hive (`HKEY_CURRENT_USER\Environment`), accessible exclusively by your logged-in Windows user account.
   - No vault files or password files exist on disk (`~/.agweb-reports` contains zero credential files).

3. **Security Audit Command**:
   - You can audit the system at any time to verify that no username or password is stored anywhere:
     ```bash
     node scripts/auth.cjs audit
     ```
   - Confirms that `AGWEB_REPORTS_USER` is empty, `AGWEB_REPORTS_PASS` is empty, and no credential files exist on disk.

4. **Re-Authentication Flow**:
   - If Admin.Api returns `HTTP 401 Unauthorized` (`realm="Reset"`), the skill prompts for updated credentials, verifies the new token against `/api/account/GetAuthenticatedUser`, and overwrites `AGWEB_REPORTS_BASIC_AUTH`.

---

## Kubernetes Ingress and Environments

The reporting site (`Admin.Api` backend and `ReactWeb` frontend) is deployed via Helm/Kubernetes manifests in `.devrun/kubernetes` with ingress routing configured on shared hosts:

- **Host**: `prod.reset.osttra.xyz` (for prod instances) and `dev.reset.osttra.xyz` (for UAT and QA instances)
- **Path Base**: `/{environment}/agweb` (e.g. `/prod/agweb`)
- **Supported Environments**:
  - `PROD`: `https://prod.reset.osttra.xyz/prod/agweb` (default)
  - `PATCH`: `https://dev.reset.osttra.xyz/uat/agweb`
  - `QA`: `https://dev.reset.osttra.xyz/qa/agweb`

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
