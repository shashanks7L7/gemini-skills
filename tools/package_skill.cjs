#!/usr/bin/env node

/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill Packager - Creates a distributable .skill archive from a skill folder.
 * Supports Windows (PowerShell Compress-Archive) and Unix (zip/tar).
 *
 * Usage:
 *     node tools/package_skill.cjs <path/to/skill-folder> [output-directory]
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateSkill } = require('./validate_skill.cjs');

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log(
      'Usage: node tools/package_skill.cjs <path/to/skill-folder> [output-directory]',
    );
    process.exit(1);
  }

  const skillPathArg = args[0];
  const outputDirArg = args[1];

  if (
    skillPathArg.includes('..') ||
    (outputDirArg && outputDirArg.includes('..'))
  ) {
    console.error('❌ Error: Path traversal detected in arguments.');
    process.exit(1);
  }

  const skillPath = path.resolve(skillPathArg);
  const outputDir = outputDirArg ? path.resolve(outputDirArg) : process.cwd();
  const skillName = path.basename(skillPath);

  // 1. Validate first
  console.log('🔍 Validating skill...');
  const result = validateSkill(skillPath);
  if (!result.valid) {
    console.error(`❌ Validation failed: ${result.message}`);
    process.exit(1);
  }

  if (result.warning) {
    console.warn(`⚠️  ${result.warning}`);
    console.log('Please resolve all TODOs before packaging.');
    process.exit(1);
  }
  console.log('✅ Skill is valid!');

  // 2. Package
  const outputFilename = path.join(outputDir, `${skillName}.skill`);

  try {
    let zipProcess = spawnSync('zip', ['-r', outputFilename, '.'], {
      cwd: skillPath,
      stdio: 'inherit',
    });

    if (zipProcess.error || zipProcess.status !== 0) {
      if (process.platform === 'win32') {
        const tempZip = outputFilename + '.zip';
        const safeTempZip = tempZip.replace(/'/g, "''");
        zipProcess = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `Compress-Archive -Path .\\* -DestinationPath '${safeTempZip}' -Force`,
          ],
          {
            cwd: skillPath,
            stdio: 'inherit',
          },
        );

        if (zipProcess.status === 0 && fs.existsSync(tempZip)) {
          if (fs.existsSync(outputFilename)) {
            fs.unlinkSync(outputFilename);
          }
          fs.renameSync(tempZip, outputFilename);
        }
      } else {
        zipProcess = spawnSync(
          'tar',
          ['-a', '-c', '--format=zip', '-f', outputFilename, '.'],
          {
            cwd: skillPath,
            stdio: 'inherit',
          },
        );
      }
    }

    if (zipProcess.error) {
      throw zipProcess.error;
    }

    if (zipProcess.status !== 0) {
      throw new Error(
        `Packaging command failed with exit code ${zipProcess.status}`,
      );
    }

    console.log(`✅ Successfully packaged skill to: ${outputFilename}`);
  } catch (err) {
    console.error(`❌ Error packaging: ${err.message}`);
    process.exit(1);
  }
}

main();
