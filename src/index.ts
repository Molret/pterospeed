#!/usr/bin/env node

import chalk from 'chalk';
import { Command } from 'commander';
import { execa } from 'execa';
import path from 'node:path';
import fs from 'fs-extra';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import pkg from '../package.json';
import { analyzeProject, optimizeProject, revertProject } from './analyze';
import { loadProject } from './project';
import { printAnalysis, printBenchmark, printDiff, printOptimize, printProject, title } from './ui';
import type { BenchmarkResult, Preset, ProjectContext } from './types';

const program = new Command();

program
    .name('pterospeed')
    .description('Analyze and optimize Pterodactyl panel build performance.')
    .version(pkg.version);

program
    .argument('[path]', 'project path', '.')
    .action(async (projectPath) => {
        await runAnalyze(projectPath);
    });

program
    .command('analyze')
    .argument('[path]', 'project path', '.')
    .action(async (projectPath) => {
        await runAnalyze(projectPath);
    });

program
    .command('optimize')
    .argument('[path]', 'project path', '.')
    .option('--auto', 'apply without prompt', false)
    .option('--dry', 'show diff only', false)
    .option('--preset <preset>', 'safe or aggressive', 'safe')
    .action(async (projectPath, options) => {
        const preset = normalizePreset(options.preset);
        await runOptimize(projectPath, { auto: Boolean(options.auto), dry: Boolean(options.dry), preset });
    });

program
    .command('benchmark')
    .argument('[path]', 'project path', '.')
    .action(async (projectPath) => {
        await runBenchmark(projectPath);
    });

program
    .command('revert')
    .argument('[path]', 'project path', '.')
    .action(async (projectPath) => {
        await runRevert(projectPath);
    });

program.parseAsync(process.argv).catch((error: Error) => {
    console.error(chalk.red(`✖ ${error.message}`));
    process.exitCode = 1;
});

async function runAnalyze(projectPath: string): Promise<void> {
    const project = await loadProject(projectPath);
    const result = await analyzeProject(project);

    console.log(title(pkg.version));
    for (const line of printProject(project)) {
        console.log(line);
    }
    console.log(chalk.cyan('Scanning build configuration...'));
    console.log('');
    for (const line of printAnalysis(result)) {
        console.log(line);
    }
}

async function runOptimize(
    projectPath: string,
    options: {
        auto: boolean;
        dry: boolean;
        preset: Preset;
    },
): Promise<void> {
    const project = await loadProject(projectPath);
    const shouldPreviewOnly = options.dry || !options.auto;
    const result = await optimizeProject(project, {
        auto: options.auto,
        dryRun: shouldPreviewOnly,
        preset: options.preset,
    });

    console.log(title(pkg.version));
    for (const line of printProject(project)) {
        console.log(line);
    }
    console.log(chalk.cyan(`Optimize preset: ${options.preset}`));
    console.log('');

    if (result.diff.trim()) {
        for (const line of printDiff(result.diff)) {
            console.log(line);
        }
        console.log('');
    }

    if (!options.dry && !options.auto && result.changedFiles.length) {
        const confirmed = await confirmProceed();
        if (!confirmed) {
            console.log(chalk.yellow('⚠ Aborted. Re-run with --auto to skip prompt.'));
            return;
        }

        const applied = await optimizeProject(project, {
            auto: true,
            dryRun: false,
            preset: options.preset,
        });
        for (const line of printOptimize(applied, project)) {
            console.log(line);
        }
        return;
    }

    for (const line of printOptimize(result, project)) {
        console.log(line);
    }
}

async function runRevert(projectPath: string): Promise<void> {
    const project = await loadProject(projectPath);
    const restored = await revertProject(project);

    console.log(title(pkg.version));
    if (!restored.length) {
        console.log(chalk.yellow('⚠ Nothing restored.'));
        return;
    }

    console.log(chalk.green(`✓ Restored ${restored.join(', ')}.`));
}

async function runBenchmark(projectPath: string): Promise<void> {
    const project = await loadProject(projectPath);
    const result = await benchmarkProject(project);

    console.log(title(pkg.version));
    for (const line of printProject(project)) {
        console.log(line);
    }
    console.log('');
    for (const line of printBenchmark(result)) {
        console.log(line);
    }
}

async function benchmarkProject(project: ProjectContext): Promise<BenchmarkResult> {
    const runs: BenchmarkResult['runs'] = [];
    const devScript = getScriptName(project, 'build');
    const prodScript = getScriptName(project, 'build:production');

    await clearWebpackCache(project);
    runs.push(await runScript(project, 'Cold dev build', devScript));
    runs.push(await runScript(project, 'Warm dev build', devScript));

    if (prodScript) {
        runs.push(await runScript(project, 'Production build', prodScript));
    }

    return { runs };
}

function getScriptName(project: ProjectContext, preferred: string): string {
    const scripts = project.packageJson?.scripts || {};
    if (scripts[preferred]) {
        return preferred;
    }

    if (preferred === 'build') {
        throw new Error('No build script found.');
    }

    return '';
}

async function runScript(project: ProjectContext, label: string, scriptName: string) {
    if (!scriptName) {
        return {
            label,
            command: 'skipped',
            durationMs: 0,
        };
    }

    const command = project.packageManager;
    const args = command === 'yarn' ? [scriptName] : ['run', scriptName];
    const startedAt = Date.now();

    try {
        await execa(command, args, {
            cwd: project.rootDir,
            stdout: 'pipe',
            stderr: 'pipe',
        });
    } catch (error: any) {
        const stderr = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
        throw new Error(`Benchmark failed on "${label}". ${stderr || 'Unknown error.'}`);
    }

    return {
        label,
        command: `${command} ${args.join(' ')}`,
        durationMs: Date.now() - startedAt,
    };
}

async function clearWebpackCache(project: ProjectContext): Promise<void> {
    const candidates = [
        path.join(project.rootDir, 'node_modules', '.cache', 'webpack'),
        path.join(project.rootDir, '.cache', 'webpack'),
    ];

    for (const candidate of candidates) {
        if (await fs.pathExists(candidate)) {
            await fs.remove(candidate);
        }
    }
}

function normalizePreset(value: string): Preset {
    if (value === 'safe' || value === 'aggressive') {
        return value;
    }

    throw new Error(`Invalid preset "${value}". Use safe or aggressive.`);
}

async function confirmProceed(): Promise<boolean> {
    const rl = createInterface({ input, output });
    try {
        const answer = await rl.question('Apply changes? [y/N] ');
        return ['y', 'yes'].includes(answer.trim().toLowerCase());
    } finally {
        rl.close();
    }
}
