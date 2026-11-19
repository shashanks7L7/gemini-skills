/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Quick validation logic for Gemini CLI skills.
 * Zero-dependency standalone validator.
 */

const fs = require('node:fs');
const path = require('node:path');

function validateSkill(skillPath) {
  if (!fs.existsSync(skillPath) || !fs.statSync(skillPath).isDirectory()) {
    return { valid: false, message: `Path is not a directory: ${skillPath}` };
  }

  const skillMdPath = path.join(skillPath, 'SKILL.md');
  if (!fs.existsSync(skillMdPath)) {
    return { valid: false, message: 'SKILL.md not found' };
  }

  const content = fs.readFileSync(skillMdPath, 'utf8');
  if (!content.startsWith('---')) {
    return { valid: false, message: 'No YAML frontmatter found' };
  }

  const parts = content.split('---');
  if (parts.length < 3) {
    return { valid: false, message: 'Invalid frontmatter format' };
  }

  const frontmatterText = parts[1];

  const nameMatch = frontmatterText.match(/^name:\s*(.+)$/m);
  const descMatch = frontmatterText.match(
    /^description:\s*(?:'([^']*)'|"([^"]*)"|(.+))$/m,
  );

  if (!nameMatch)
    return { valid: false, message: 'Missing "name" in frontmatter' };
  if (!descMatch)
    return {
      valid: false,
      message: 'Description must be a single-line string: description: ...',
    };

  const name = nameMatch[1].trim();
  const description = (
    descMatch[1] !== undefined
      ? descMatch[1]
      : descMatch[2] !== undefined
        ? descMatch[2]
        : descMatch[3] || ''
  ).trim();

  if (description.includes('\n')) {
    return {
      valid: false,
      message: 'Description must be a single line (no newlines)',
    };
  }

  if (!/^[a-z0-9-]+$/.test(name)) {
    return { valid: false, message: `Name "${name}" should be hyphen-case (lowercase letters, numbers, and hyphens)` };
  }

  if (description.length > 1024) {
    return { valid: false, message: 'Description is too long (max 1024 characters)' };
  }

  const validKeys = ['name', 'description'];
  const lines = frontmatterText.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const key = trimmed.slice(0, colonIdx).trim();
      if (!validKeys.includes(key)) {
        return {
          valid: false,
          message: `Unknown frontmatter key "${key}". Only name and description are supported.`,
        };
      }
    }
  }

  if (content.includes('TODO')) {
    return {
      valid: true,
      warning: 'Contains unresolved TODO markers in SKILL.md',
    };
  }

  return { valid: true };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log('Usage: node validate_skill.cjs <path/to/skill-folder>');
    process.exit(1);
  }

  const result = validateSkill(path.resolve(args[0]));
  if (result.valid) {
    console.log('✅ Skill is valid!');
    if (result.warning) {
      console.warn(`⚠️  Warning: ${result.warning}`);
    }
    process.exit(0);
  } else {
    console.error(`❌ Validation failed: ${result.message}`);
    process.exit(1);
  }
}

module.exports = { validateSkill };
