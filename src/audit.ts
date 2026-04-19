import fs from 'fs-extra';
import path from 'node:path';
import { execa } from 'execa';
import type { AuditItem, AuditOptions, AuditResult, ReportData } from './types';

const REPORT_BASE_URL = 'https://pterospeed.me/r';

export async function detectPanelUrl(rootDir: string): Promise<string | undefined> {
    const envPath = path.join(rootDir, '.env');
    if (!(await fs.pathExists(envPath))) return undefined;

    const content = await fs.readFile(envPath, 'utf8');
    const match = content.match(/^APP_URL\s*=\s*(.+)$/m);
    if (!match) return undefined;

    return match[1].trim().replace(/^["']|["']$/g, '');
}

export async function runAudit(url: string, options: AuditOptions): Promise<AuditResult[]> {
    const strategies: Array<'mobile' | 'desktop'> =
        options.strategy === 'both' ? ['mobile', 'desktop'] : [options.strategy];

    const results: AuditResult[] = [];
    const rootDir = options.rootDir ?? process.cwd();

    for (const strategy of strategies) {
        results.push(await runUnlighthouseAudit(rootDir, url, strategy));
    }

    return results;
}

async function runUnlighthouseAudit(
    rootDir: string,
    url: string,
    strategy: 'mobile' | 'desktop',
): Promise<AuditResult> {
    const outputPath = path.join(rootDir, '.pterospeed', 'audit', strategy);
    await fs.ensureDir(outputPath);
    await fs.remove(path.join(outputPath, 'ci-result.json'));
    const configPath = await writeUnlighthouseConfig(rootDir, outputPath, url, strategy);

    const args = [
        '-y',
        '--package',
        '@unlighthouse/cli',
        '--package',
        'puppeteer',
        'unlighthouse-ci',
        '--root',
        rootDir,
        '--config-file',
        configPath,
    ];

    try {
        await execa('npx', args, {
            cwd: rootDir,
            stdout: 'pipe',
            stderr: 'pipe',
            reject: true,
            timeout: 5 * 60 * 1000,
        });
    } catch (error: any) {
        const stderr = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
        throw new Error(
            `Unlighthouse audit failed for "${url}". ${
                stderr || 'Make sure the panel is reachable and Puppeteer can start Chromium.'
            }`,
        );
    }

    const reportPath = path.join(outputPath, 'ci-result.json');
    if (!(await fs.pathExists(reportPath))) {
        throw new Error(`Unlighthouse did not produce ${reportPath}.`);
    }

    const data = await fs.readJson(reportPath);
    return parseUnlighthouseResponse(data, url, strategy);
}

function parseUnlighthouseResponse(
    data: any,
    url: string,
    strategy: 'mobile' | 'desktop',
): AuditResult {
    const summary = data?.summary ?? {};
    const categories = summary.categories ?? {};
    const metrics = summary.metrics ?? {};

    const scores = {
        performance: toScore(categories.performance?.averageScore),
        accessibility: toScore(categories.accessibility?.averageScore),
        bestPractices: toScore(categories['best-practices']?.averageScore),
        seo: toScore(categories.seo?.averageScore),
    };

    const metricItems: AuditItem[] = [
        metricItem('largest-contentful-paint', 'Largest Contentful Paint', metrics['largest-contentful-paint']?.averageNumericValue, 'ms', 2500),
        metricItem('first-contentful-paint', 'First Contentful Paint', metrics['first-contentful-paint']?.averageNumericValue, 'ms', 1800),
        metricItem('total-blocking-time', 'Total Blocking Time', metrics['total-blocking-time']?.averageNumericValue, 'ms', 200),
        metricItem('cumulative-layout-shift', 'Cumulative Layout Shift', metrics['cumulative-layout-shift']?.averageNumericValue, '', 0.1),
        metricItem('interactive', 'Time to Interactive', metrics['interactive']?.averageNumericValue, 'ms', 3800),
    ].filter((item): item is AuditItem => Boolean(item));

    return {
        url,
        strategy,
        provider: 'unlighthouse',
        scores,
        audits: metricItems,
        fetchTime: new Date().toISOString(),
    };
}

function toScore(raw: number | null | undefined): number {
    if (raw == null) return 0;
    return Math.round(raw * 100);
}

function metricItem(
    id: string,
    title: string,
    numericValue: number | undefined,
    unit: string,
    goodThreshold: number,
): AuditItem | undefined {
    if (typeof numericValue !== 'number') {
        return undefined;
    }

    const normalized = unit === 'ms' ? Math.round(numericValue) : Number(numericValue.toFixed(3));
    const displayValue = unit ? `${normalized}${unit}` : `${normalized}`;
    const score = numericValue <= goodThreshold ? 1 : 0;

    return {
        id,
        title,
        score,
        value: displayValue,
    };
}

async function writeUnlighthouseConfig(
    rootDir: string,
    outputPath: string,
    url: string,
    strategy: 'mobile' | 'desktop',
): Promise<string> {
    const parsed = new URL(url);
    const site = parsed.origin;
    const routePath = `${parsed.pathname || '/'}${parsed.search || ''}`;
    const configPath = path.join(outputPath, 'unlighthouse.config.mjs');
    const configSource = [
        'export default {',
        `  site: ${JSON.stringify(site)},`,
        `  root: ${JSON.stringify(rootDir)},`,
        `  outputPath: ${JSON.stringify(outputPath)},`,
        `  urls: [${JSON.stringify(routePath)}],`,
        `  scanner: {`,
        `    device: ${JSON.stringify(strategy)},`,
        '    samples: 1,',
        '    dynamicSampling: false,',
        '    sitemap: false,',
        '    robotsTxt: false,',
        '  },',
        '  ci: {',
        "    reporter: 'jsonExpanded',",
        '  },',
        '};',
        '',
    ].join('\n');

    await fs.writeFile(configPath, configSource, 'utf8');
    return configPath;
}

export function buildReportData(
    project: string,
    auditResult?: AuditResult,
    build?: { score: number; applied: number },
): ReportData {
    return {
        v: 1,
        project,
        url: auditResult?.url ?? '',
        ts: Math.floor(Date.now() / 1000),
        audit: auditResult,
        build,
    };
}

export function encodeReport(data: ReportData): string {
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function buildReportUrl(data: ReportData): string {
    return `${REPORT_BASE_URL}?d=${encodeReport(data)}`;
}

export async function writeReportFile(rootDir: string, kind: string, data: ReportData): Promise<string> {
    const reportDir = path.join(rootDir, '.pterospeed', 'reports');
    await fs.ensureDir(reportDir);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(reportDir, `${kind}-${stamp}.json`);
    await fs.writeJson(reportPath, data, { spaces: 2 });
    return reportPath;
}
