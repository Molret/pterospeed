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
import { buildReportData, buildReportUrl, detectPanelUrl, runAudit, writeReportFile } from './audit';
import { loadProject } from './project';
import { printAnalysis, printAudit, printBenchmark, printDiff, printOptimize, printProject, title } from './ui';
import type { BenchmarkResult, Preset, ProjectContext } from './types';

const program = new Command();

program
    .name('pterospeed')
    .description('Analyze and optimize Pterodactyl panel build performance.')
    .option('--preset <preset>', 'analyze using safe or aggressive framing', 'safe')
    .version(pkg.version);

program
    .argument('[path]', 'project path', '.')
    .action(async (projectPath, command) => {
        const options = typeof command?.opts === 'function' ? command.opts() : command;
        await runAnalyze(projectPath, normalizePreset(readPresetArg(options.preset)));
    });

program
    .command('analyze')
    .argument('[path]', 'project path', '.')
    .option('--preset <preset>', 'safe or aggressive', 'safe')
    .action(async (projectPath, command) => {
        const options = typeof command?.opts === 'function' ? command.opts() : command;
        await runAnalyze(projectPath, normalizePreset(readPresetArg(options.preset)));
    });

program
    .command('optimize')
    .argument('[path]', 'project path', '.')
    .option('--auto', 'apply without prompt', false)
    .option('--dry', 'show diff only', false)
    .option('--preset <preset>', 'safe or aggressive', 'safe')
    .action(async (projectPath, command) => {
        const options = typeof command?.opts === 'function' ? command.opts() : command;
        const preset = normalizePreset(readPresetArg(options.preset));
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

program
    .command('audit')
    .argument('[url]', 'panel URL to audit (auto-detected from .env if omitted)')
    .option('--path <path>', 'project path for .env auto-detection', '.')
    .option('--strategy <strategy>', 'mobile, desktop, or both', 'desktop')
    .action(async (url, options) => {
        await runAuditCmd(url, options);
    });

program.parseAsync(process.argv).catch((error: Error) => {
    console.error(chalk.red(`✖ ${error.message}`));
    process.exitCode = 1;
});

async function runAnalyze(projectPath: string, preset: Preset): Promise<void> {
    const startedAt = Date.now();
    const project = await loadProject(projectPath);
    const result = await analyzeProject(project, preset);

    console.log(title(pkg.version));
    for (const line of printProject(project)) {
        console.log(line);
    }
    console.log(`${chalk.green('✔')} Found ${project.sourceFileCount} source files.`);
    console.log(`${chalk.green('✔')} Analyze preset: ${chalk.dim(preset)}`);
    console.log(chalk.cyan('Scanning build configuration...'));
    console.log('');
    for (const line of printAnalysis(result, Date.now() - startedAt)) {
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
        const share = await buildOptimizeShare(project, applied, options.preset);
        for (const line of printOptimize(applied, project, share)) {
            console.log(line);
        }
        return;
    }

    const share =
        options.auto && !options.dry && result.changedFiles.length
            ? await buildOptimizeShare(project, result, options.preset)
            : undefined;
    for (const line of printOptimize(result, project, share)) {
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

    await preflightBenchmark(project);
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
            env: buildScriptEnv(project),
        });
    } catch (error: any) {
        const stderr = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
        throw new Error(formatBenchmarkFailure(project, label, scriptName, stderr));
    }

    return {
        label,
        command: `${command} ${args.join(' ')}`,
        durationMs: Date.now() - startedAt,
    };
}

async function preflightBenchmark(project: ProjectContext): Promise<void> {
    const source = (await fs.readFile(project.webpackConfigPath, 'utf8').catch(() => '')) || '';
    if (!source.includes('esbuild-loader')) {
        return;
    }

    const dependencyPath = path.join(project.rootDir, 'node_modules', 'esbuild-loader');
    if (!(await fs.pathExists(dependencyPath))) {
        throw new Error(
            `Benchmark blocked: webpack.config.js references "esbuild-loader" but it is not installed.\n` +
            `Run "${project.packageManager} install" and retry.`,
        );
    }
}

function formatBenchmarkFailure(
    project: ProjectContext,
    label: string,
    scriptName: string,
    stderr: string,
): string {
    const missingModule = stderr.match(/Cannot find module '([^']+)'/);
    if (missingModule?.[1]) {
        return (
            `Benchmark blocked on "${label}": missing module "${missingModule[1]}".\n` +
            `Run "${project.packageManager} install" in the panel root and retry.`
        );
    }

    if (/ERR_OSSL_EVP_UNSUPPORTED|digital envelope routines::unsupported/i.test(stderr)) {
        const directCmd =
            project.packageManager === 'yarn'
                ? `NODE_OPTIONS=--openssl-legacy-provider yarn ${scriptName}`
                : `NODE_OPTIONS=--openssl-legacy-provider npm run ${scriptName}`;
        return (
            `Benchmark failed on "${label}": OpenSSL incompatibility with webpack ${project.webpackMajor} on ${process.version}.\n` +
            `pterospeed already injects NODE_OPTIONS for webpack 4; if your environment strips it, run:\n` +
            `${directCmd}`
        );
    }

    const excerpt = stderr.split('\n').slice(0, 16).join('\n');
    return `Benchmark failed on "${label}". ${excerpt || 'Unknown error.'}`;
}

function buildScriptEnv(project: ProjectContext): NodeJS.ProcessEnv {
    const env = { ...process.env };
    if (project.webpackMajor < 5) {
        const current = env.NODE_OPTIONS || '';
        if (!current.includes('--openssl-legacy-provider')) {
            env.NODE_OPTIONS = `${current} --openssl-legacy-provider`.trim();
        }
    }
    return env;
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

async function runAuditCmd(
    urlArg: string | undefined,
    options: { path: string; strategy: string },
): Promise<void> {
    console.log(title(pkg.version));

    const rootDir = path.resolve(options.path);
    let url = urlArg;

    if (!url) {
        console.log(chalk.cyan('Auto-detecting panel URL from .env...'));
        url = await detectPanelUrl(rootDir);
        if (!url) {
            throw new Error(
                'No URL provided and APP_URL not found in .env.\n' +
                'Usage: pterospeed audit https://panel.yourhost.com',
            );
        }
        console.log(`${chalk.green('✔')} Found APP_URL: ${chalk.dim(url)}`);
    }

    const strategy = options.strategy === 'both' ? 'both'
        : options.strategy === 'mobile' ? 'mobile'
        : 'desktop';

    console.log('');
    console.log(chalk.cyan(`Running site audit (${strategy})...`));
    console.log(chalk.dim('  This may take 10-60 seconds.'));
    console.log('');

    const results = await runAudit(url, { strategy, rootDir });

    const projectName = await detectProjectName(rootDir);
    const reportData = buildReportData(projectName, results[0]);
    const reportUrl = buildReportUrl(reportData);
    const reportPath = await writeReportFile(rootDir, 'audit', reportData);

    for (const line of printAudit(results, reportUrl, reportPath)) {
        console.log(line);
    }
}

async function buildOptimizeShare(
    project: ProjectContext,
    result: { applied: string[]; changedFiles: string[] },
    preset: Preset,
): Promise<{ reportUrl?: string; reportPath?: string } | undefined> {
    if (!result.changedFiles.length) {
        return undefined;
    }

    try {
        const analyzed = await analyzeProject(project, preset);
        const projectName = project.packageJson?.name || path.basename(project.rootDir) || 'pterodactyl-panel';
        const reportData = buildReportData(projectName, undefined, {
            score: analyzed.score,
            applied: result.applied.length,
        });
        return {
            reportUrl: buildReportUrl(reportData),
            reportPath: await writeReportFile(project.rootDir, 'build', reportData),
        };
    } catch {
        return undefined;
    }
}

async function detectProjectName(rootDir: string): Promise<string> {
    try {
        const pkgPath = path.join(rootDir, 'package.json');
        if (await fs.pathExists(pkgPath)) {
            const p = await fs.readJson(pkgPath);
            if (p?.name) return String(p.name);
        }
    } catch {}
    return 'pterodactyl-panel';
}

function normalizePreset(value: string): Preset {
    if (value === 'safe' || value === 'aggressive') {
        return value;
    }

    throw new Error(`Invalid preset "${value}". Use safe or aggressive.`);
}

function readPresetArg(fallback: string): string {
    const index = process.argv.indexOf('--preset');
    if (index >= 0 && process.argv[index + 1]) {
        return process.argv[index + 1];
    }

    return fallback;
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
