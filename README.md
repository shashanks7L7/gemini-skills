# gemini-skills

Git repository to maintain, validate, package, and update specialized skills for **Gemini CLI**.

---

## Table of Contents

1. [Overview](#overview)
2. [Skill Anatomy](#skill-anatomy)
3. [How to Validate a Skill](#how-to-validate-a-skill)
4. [How to Package a Skill for Distribution](#how-to-package-a-skill-for-distribution)
5. [How to Update an Existing Skill](#how-to-update-an-existing-skill)
6. [Installing and Reloading Skills](#installing-and-reloading-skills)
7. [Skill Development Best Practices](#skill-development-best-practices)

---

## Overview

Gemini CLI skills are self-contained procedural extensions that transform Gemini CLI into a specialized agent equipped with domain workflows, executable helper scripts, and API references.

This repository contains:
- Source skill directories (e.g., `agweb-reports/`)
- Packaging and validation utilities (`tools/`)
- Distributable `.skill` packages (e.g., `agweb-reports.skill`)

---

## Skill Anatomy

Every skill directory follows this standardized layout:

```
<skill-name>/
├── SKILL.md              # [Required] Main workflow guide with YAML frontmatter
├── scripts/              # [Optional] Executable scripts (Node.js .cjs, Python, shell)
└── references/           # [Optional] Detailed API schemas, docs, and configurations
```

### `SKILL.md` Frontmatter Specification

The `SKILL.md` file **must** begin with valid YAML frontmatter containing only two fields:

```yaml
---
name: your-skill-name
description: Clear, single-line explanation of what the skill does and WHEN to trigger it.
---
```

- **`name`**: Lowercase alphanumeric characters and hyphens only (e.g., `agweb-reports`).
- **`description`**: A **single line** (no newlines), maximum 1024 characters. It must explain both what the skill does and specific user prompts or file types that trigger it.
- **No extra keys**: Do not add fields like `version`, `author`, or `tags` to the frontmatter.

---

## How to Validate a Skill

Before packaging or distributing a skill, validate it to ensure it satisfies all structural and frontmatter requirements.

### Running the Validator

Run the bundled zero-dependency validator from the repository root:

```bash
node tools/validate_skill.cjs <path/to/skill-folder>
```

#### Example:
```bash
node tools/validate_skill.cjs agweb-reports
```

### What the Validator Checks

1. **Directory Structure**: Confirms the folder exists and contains `SKILL.md`.
2. **YAML Frontmatter**: Verifies proper delimiter tags (`---`) and structure.
3. **`name` Attribute**: Ensures hyphen-case formatting (`^[a-z0-9-]+$`).
4. **`description` Attribute**: Ensures it is a single line, non-empty, and $\le$ 1024 characters.
5. **Key Whitelist**: Rejects any unsupported frontmatter properties.
6. **TODO Scan**: Flags any unresolved `TODO` markers remaining from templates.

**Expected Output:**
```
✅ Skill is valid!
```

If validation fails, the validator exits with code `1` and prints the exact reason for failure.

---

## How to Package a Skill for Distribution

Packaging bundles the skill folder into a `.skill` archive (a zip-compatible distribution package) that can be installed by Gemini CLI users.

### Running the Packager

```bash
node tools/package_skill.cjs <path/to/skill-folder> [output-directory]
```

#### Example:
```bash
# Package agweb-reports into the current folder:
node tools/package_skill.cjs agweb-reports .
```

### Packager Workflow

1. **Automatic Pre-Validation**: The script automatically executes `validateSkill()` first. If validation fails or unresolved `TODO` markers remain, packaging halts.
2. **Cross-Platform Compression**:
   - Uses native `zip` if available (macOS / Linux).
   - Falls back automatically to PowerShell `Compress-Archive` on Windows.
3. **Output**: Produces `<skill-name>.skill` in the specified output directory.

---

## How to Update an Existing Skill

When modifying or enhancing a skill, follow this lifecycle:

```
[Edit Files] ──► [Test Scripts] ──► [Validate] ──► [Package] ──► [Install & Reload]
```

### Step-by-Step Guide

### 1. Make Your Changes
- **Workflows**: Update instructions, decision trees, or prompts in `<skill-name>/SKILL.md`.
- **Scripts**: Update helper logic in `<skill-name>/scripts/` (e.g., `fetch_reports.cjs`, `auth.cjs`).
- **References**: Update schemas, endpoints, or environment tables in `<skill-name>/references/`.

### 2. Test Scripts Locally
Run your modified scripts directly from the terminal to verify functionality:
```bash
# Test network check
node agweb-reports/scripts/check_network.cjs

# Run credential audit
node agweb-reports/scripts/auth.cjs audit

# Test mock data generation or dry run
node agweb-reports/scripts/fetch_reports.cjs --mock --type summary
```

### 3. Re-Validate the Skill
Ensure your updates did not introduce frontmatter issues or leftover TODOs:
```bash
node tools/validate_skill.cjs agweb-reports
```

### 4. Re-Package the Distributable
Re-generate the `.skill` file:
```bash
node tools/package_skill.cjs agweb-reports .
```

### 5. Re-Install and Reload
Update your installed skill in Gemini CLI (see next section).

---

## Installing and Reloading Skills

Once a skill is packaged into `<skill-name>.skill`, install it into your Gemini CLI environment:

### Installation Options

#### User Scope (Recommended — available across all projects):
```bash
gemini skills install <path/to/skill-name.skill> --scope user
```

#### Workspace Scope (Available only in current project folder):
```bash
gemini skills install <path/to/skill-name.skill> --scope workspace
```

### Reloading Active Skills

After installing or updating a skill, you **must reload** your interactive Gemini CLI session for changes to take effect:

1. In your interactive Gemini CLI session, run:
   ```
   /skills reload
   ```
2. Verify that the skill is active and loaded:
   ```
   /skills list
   ```

*(Note: Agents cannot run `/skills reload` for you; you must run it manually in your interactive CLI prompt).*

---

## Skill Development Best Practices

1. **Context Window Efficiency**:
   - The context window is shared with conversation history, system instructions, and tool output. Keep `SKILL.md` concise and high-signal. Avoid conversational filler or redundant documentation.
2. **Agentic Ergonomics in Scripts**:
   - **Suppress Tracebacks**: Trap errors gracefully and write clean, actionable failure messages to `stderr`.
   - **Exit Codes**:
     - `0`: Success
     - `1`: General error / missing parameters / network disconnected
     - `2`: Authentication failure (signals agent to prompt for re-auth)
   - **Structured Output**: Output pure JSON or formatted summaries to `stdout` so agents can parse results easily.
3. **Security First**:
   - **Token-Only Authentication**: Never persist raw passwords or usernames to disk or environment variables. Compute base64 tokens in memory and store only the header token.
   - **Strictly Read-Only for Production**: Restrict reporting skills to HTTP `GET` requests and enforce code-level blocklists against mutating operations (`POST`, `PUT`, `DELETE`, update, import).
   - **Network Guardrails**: Verify corporate network or VPN presence before issuing internal network queries.
