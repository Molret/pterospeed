import fs from 'fs-extra';
import path from 'node:path';
import type { AuditItem, AuditOptions, AuditResult, ReportData } from './types';

const PAGESPEED_API = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

// Audits most relevant to Pterodactyl/Laravel panels
const PTERODACTYL_AUDIT_IDS = [
    'server-response-time',       // TTFB — Laravel boot time
    'render-blocking-resources',  // webpack bundle blocking render
    'uses-text-compression',      // gzip/brotli on assets
    'uses-long-cache-ttl',        // cache headers on static files
    'total-byte-weight',          // total transfer size
    'bootup-time',                // JS execution time
    'unused-javascript',          // tree-shaking quality
    'unused-css-rules',           // CSS purging
    'dom-size',                   // React component tree size
    'uses-optimized-images',      // image optimization
];

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

    for (const strategy of strategies) {
        results.push(await fetchAudit(url, strategy, options.apiKey));
    }

    return results;
}

async function fetchAudit(url: string, strategy: 'mobile' | 'desktop', apiKey?: string): Promise<AuditResult> {
    const params = new URLSearchParams({ url, strategy });
    if (apiKey) params.set('key', apiKey);

    const endpoint = `${PAGESPEED_API}?${params}`;
    const res = await fetch(endpoint);

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (res.status === 400) {
            throw new Error(
                `PageSpeed API could not reach "${url}". Make sure the panel is publicly accessible.`,
            );
        }
        throw new Error(`PageSpeed API error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as any;
    return parsePageSpeedResponse(data, strategy);
}

function parsePageSpeedResponse(data: any, strategy: 'mobile' | 'desktop'): AuditResult {
    const cats = data?.lighthouseResult?.categories ?? {};
    const rawAudits = data?.lighthouseResult?.audits ?? {};

    const scores = {
        performance: toScore(cats.performance?.score),
        accessibility: toScore(cats.accessibility?.score),
        bestPractices: toScore(cats['best-practices']?.score),
        seo: toScore(cats.seo?.score),
    };

    const audits: AuditItem[] = PTERODACTYL_AUDIT_IDS
        .filter((id) => rawAudits[id])
        .map((id) => ({
            id,
            title: rawAudits[id].title as string,
            score: rawAudits[id].score as number | null,
            value: rawAudits[id].displayValue as string | undefined,
        }))
        .filter((a) => a.score !== null && a.score < 0.9); // only show issues

    return {
        url: data.id ?? data.lighthouseResult?.finalUrl ?? '',
        strategy,
        scores,
        audits,
        fetchTime: data.lighthouseResult?.fetchTime ?? new Date().toISOString(),
    };
}

function toScore(raw: number | null | undefined): number {
    if (raw == null) return 0;
    return Math.round(raw * 100);
}

export function encodeReport(data: ReportData): string {
    return Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
}

export function buildReportUrl(data: ReportData): string {
    const id = Math.random().toString(36).slice(2, 8);
    const encoded = encodeReport(data);
    return `https://pterospeed.me/r/${id}?d=${encoded}`;
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
