import boxen from 'boxen';
import chalk from 'chalk';
import path from 'node:path';
import type { AnalysisResult, AuditResult, BenchmarkResult, Finding, OptimizeResult, ProjectContext } from './types';

const GITHUB_URL = 'https://github.com/Molret/pterospeed';

export function title(version: string): string {
    return chalk.bold.white(`pterospeed v${version}`);
}

export function printProject(project: ProjectContext): string[] {
    const label = project.isPterodactyl ? chalk.cyan('Pterodactyl Panel') : chalk.dim('Webpack project');
    const projectName = project.packageJson?.name || path.basename(project.rootDir);
    return [
        `${chalk.green('✔')} Select project to scan ${chalk.dim('›')} ${projectName}`,
        `${chalk.green('✔')} Detected: ${label}`,
        `${chalk.green('✔')} Root: ${chalk.dim(project.rootDir)}`,
        `${chalk.green('✔')} Config: ${chalk.dim(project.webpackConfigPath)}`,
    ];
}

export function printAnalysis(result: AnalysisResult, elapsedMs: number): string[] {
    const lines: string[] = [];

    for (const finding of result.findings) {
        const icon = finding.ok ? chalk.green('✓') : chalk.yellow('⚠');
        const impact = finding.ok ? '' : ` ${chalk.dim(`(${finding.impact})`)}`;
        lines.push(`${icon} ${finding.title}${impact}`);
        if (!finding.ok) {
            lines.push(`  ${chalk.dim(finding.detail)}`);
        }
    }

    lines.push('');

    const score = result.score;
    const scoreColor = score >= 90 ? chalk.green : score >= 70 ? chalk.yellow : chalk.red;
    const bar = buildBar(score, 32);
    const label = score >= 90 ? 'Great' : score >= 70 ? 'Needs work' : 'Critical';
    const issueCount = result.findings.filter((f) => !f.ok).length;
    const highCount = result.findings.filter((f) => !f.ok && f.impact === 'high').length;
    const mediumCount = result.findings.filter((f) => !f.ok && f.impact === 'medium').length;
    const lowCount = result.findings.filter((f) => !f.ok && f.impact === 'low').length;
    const elapsed = formatMs(elapsedMs);
    const issueLabel = issueCount === 1 ? 'issue' : 'issues';
    const projectCount = result.project.sourceFileCount > 0 ? `${result.project.sourceFileCount} files` : 'webpack config';
    const countsLine = [
        highCount ? chalk.red(`✗ ${highCount} high`) : '',
        mediumCount ? chalk.yellow(`⚠ ${mediumCount} medium`) : '',
        lowCount ? chalk.dim(`• ${lowCount} low`) : '',
    ].filter(Boolean).join(chalk.dim('  '));
    const footerLine = `${chalk.dim(`${issueCount} ${issueLabel} across ${projectCount} in ${elapsed}`)}`;
    const optimizeCmd = result.preset === 'aggressive'
        ? 'pterospeed optimize --preset aggressive'
        : 'pterospeed optimize';

    lines.push(
        boxen(
            [
                `${chalk.bold('pterospeed')}`,
                '',
                `${scoreColor(String(score).padStart(3))} / 100  ${chalk.dim(label)}`,
                '',
                `${scoreColor(bar)}`,
                '',
                countsLine || chalk.green('✓ No issues found'),
                footerLine,
                '',
                `${chalk.dim('Best next step:')} ${chalk.white(optimizeCmd)}`,
            ]
                .filter(Boolean)
                .join('\n'),
            { padding: 1, borderStyle: 'round' },
        ),
    );

    lines.push('');
    lines.push(chalk.dim(`Estimated gain: ${result.estimatedGain}`));

    return lines;
}

export function printOptimize(result: OptimizeResult, project: ProjectContext): string[] {
    const lines: string[] = [];

    if (!result.changedFiles.length) {
        lines.push(chalk.green('✓ No changes needed.'));
        return lines;
    }

    lines.push(`${chalk.green('✓')} Applied ${result.applied.length} optimization(s).`);
    for (const applied of result.applied) {
        lines.push(`  ${chalk.dim('-')} ${applied}`);
    }

    if (result.skipped.length) {
        lines.push(`${chalk.yellow('⚠')} Skipped ${result.skipped.length} item(s).`);
        for (const skipped of result.skipped) {
            lines.push(`  ${chalk.dim('-')} ${skipped}`);
        }
    }

    if (result.backupDir) {
        lines.push(`${chalk.green('✓')} Backup saved: ${chalk.dim(path.relative(project.rootDir, result.backupDir))}`);
    }

    if (result.needsInstall) {
        const pm = project.packageManager;
        lines.push(`${chalk.yellow('⚠')} Run ${chalk.white(`${pm} install`)} in your panel before the next build.`);
    }

    if (result.gainSummary.length) {
        lines.push('');
        const gainLines = result.gainSummary.map((g) => `  ${chalk.green('›')} ${g}`).join('\n');
        const benchmarkHint = chalk.dim(`\nRun ${chalk.white('pterospeed benchmark')} to measure your real gains.`);
        const projectName = encodeURIComponent(project.packageJson?.name ?? 'pterodactyl-panel');
        const encodedGains = encodeURIComponent(result.gainSummary.join('|'));
        const shareUrl = `https://pterospeed.me/r?p=${projectName}&a=${result.applied.length}&g=${encodedGains}`;
        const shareHint = chalk.dim(`\nShare → ${chalk.white(shareUrl)}`);
        const starLine = `\n${chalk.yellow('⭐')} Helped you? Star us → ${chalk.cyan(GITHUB_URL)}`;

        lines.push(
            boxen(
                [
                    `${chalk.bold.green('Optimizations applied!')}`,
                    '',
                    gainLines,
                    benchmarkHint,
                    shareHint,
                    starLine,
                ].join('\n'),
                { padding: 1, borderStyle: 'round', borderColor: 'green' },
            ),
        );
    }

    return lines;
}

export function printBenchmark(result: BenchmarkResult): string[] {
    const lines: string[] = [];

    for (const run of result.runs) {
        if (run.command === 'skipped') {
            lines.push(`${chalk.dim('–')} ${run.label}: ${chalk.dim('skipped')}`);
            continue;
        }
        lines.push(`${chalk.green('✓')} ${run.label}: ${chalk.bold(formatMs(run.durationMs))} ${chalk.dim(`(${run.command})`)}`);
    }

    if (result.runs.length >= 2) {
        const cold = result.runs[0];
        const warm = result.runs[1];
        if (cold && warm && warm.command !== 'skipped' && warm.durationMs < cold.durationMs) {
            const saved = cold.durationMs - warm.durationMs;
            const ratio = (cold.durationMs / warm.durationMs).toFixed(1);
            lines.push('');
            lines.push(`${chalk.green('✓')} Cache saved ${chalk.bold(formatMs(saved))} (${chalk.bold(`${ratio}x`)} faster on warm build).`);
        }
    }

    const prod = result.runs.find((r) => r.label === 'Production build' && r.command !== 'skipped');
    if (prod) {
        lines.push('');
        lines.push(`${chalk.cyan('›')} Production: ${chalk.bold(formatMs(prod.durationMs))}`);
    }

    lines.push('');
    lines.push(`${chalk.yellow('⭐')} Helped you? Star us → ${chalk.cyan(GITHUB_URL)}`);

    return lines;
}

export function printDiff(diffText: string): string[] {
    if (!diffText.trim()) {
        return [chalk.green('✓ No diff.')];
    }

    const colored = diffText
        .split('\n')
        .map((line) => {
            if (line.startsWith('+') && !line.startsWith('+++')) return chalk.green(line);
            if (line.startsWith('-') && !line.startsWith('---')) return chalk.red(line);
            if (line.startsWith('@@')) return chalk.cyan(line);
            return chalk.dim(line);
        })
        .join('\n');

    return [colored];
}

function buildBar(score: number, width: number): string {
    const filled = Math.round((score / 100) * width);
    const empty = width - filled;
    return '█'.repeat(filled) + '░'.repeat(empty);
}

function formatMs(ms: number): string {
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const rem = Math.round(seconds % 60);
    return `${minutes}m ${rem}s`;
}

export function printFindingList(findings: Finding[]): string[] {
    return findings.map((finding) => `${finding.ok ? chalk.green('✓') : chalk.yellow('⚠')} ${finding.title}`);
}

export function printAudit(results: AuditResult[], reportUrl?: string): string[] {
    const lines: string[] = [];

    for (const result of results) {
        lines.push(`${chalk.green('✔')} ${chalk.dim(result.strategy.toUpperCase())} — ${chalk.dim(result.url)}`);
        lines.push('');

        const { performance: perf, accessibility: a11y, bestPractices: bp, seo } = result.scores;

        const scoreRow = (label: string, score: number): string => {
            const color = score >= 90 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
            const bar = buildBar(score, 20);
            return `  ${chalk.dim(label.padEnd(18))} ${color(bar)} ${color(String(score).padStart(3))}/100`;
        };

        lines.push(scoreRow('Performance', perf));
        lines.push(scoreRow('Accessibility', a11y));
        lines.push(scoreRow('Best Practices', bp));
        lines.push(scoreRow('SEO', seo));

        if (result.audits.length) {
            lines.push('');
            lines.push(chalk.dim('  Issues found:'));
            for (const audit of result.audits) {
                const icon = audit.score === 0 ? chalk.red('✗') : chalk.yellow('⚠');
                const val = audit.value ? chalk.dim(` — ${audit.value}`) : '';
                lines.push(`  ${icon} ${audit.title}${val}`);
            }
        } else {
            lines.push('');
            lines.push(chalk.green('  ✓ No major issues found.'));
        }

        lines.push('');
    }

    if (reportUrl) {
        lines.push(
            boxen(
                [
                    `${chalk.bold.cyan('Panel audit complete!')}`,
                    '',
                    `${chalk.dim('View full report →')} ${chalk.white(reportUrl)}`,
                    chalk.dim(`\nRun ${chalk.white('pterospeed optimize')} to fix build performance too.`),
                    `\n${chalk.yellow('⭐')} Helped you? Star us → ${chalk.cyan(GITHUB_URL)}`,
                ].join('\n'),
                { padding: 1, borderStyle: 'round', borderColor: 'cyan' },
            ),
        );
    }

    return lines;
}
