export type PackageManager = 'yarn' | 'npm';
export type Preset = 'safe' | 'aggressive';
export type FindingId =
    | 'filesystem-cache'
    | 'babel-loader-cache'
    | 'source-map-loader-exclude'
    | 'parallelism'
    | 'terser-minifier'
    | 'always-minimize'
    | 'esbuild-transpile'
    | 'webpack-version';

export interface ProjectContext {
    rootDir: string;
    packageJsonPath: string;
    webpackConfigPath: string;
    composerJsonPath?: string;
    packageManager: PackageManager;
    packageJson: Record<string, any>;
    composerJson?: Record<string, any>;
    isPterodactyl: boolean;
    webpackMajor: number;
    sourceFileCount: number;
}

export interface Finding {
    id: FindingId;
    title: string;
    detail: string;
    impact: 'high' | 'medium' | 'low';
    fixable: boolean;
    ok: boolean;
}

export interface AnalysisResult {
    project: ProjectContext;
    findings: Finding[];
    score: number;
    estimatedGain: string;
    preset: Preset;
}

export interface OptimizeOptions {
    preset: Preset;
    dryRun: boolean;
    auto: boolean;
}

export interface OptimizeResult {
    changedFiles: string[];
    backupDir?: string;
    applied: string[];
    skipped: string[];
    diff: string;
    needsInstall: boolean;
    gainSummary: string[];
}

export interface BenchmarkRun {
    label: string;
    command: string;
    durationMs: number;
}

export interface BenchmarkResult {
    runs: BenchmarkRun[];
}

export interface AuditItem {
    id: string;
    title: string;
    score: number | null;
    value?: string;
}

export interface AuditScores {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
}

export interface AuditResult {
    url: string;
    strategy: 'mobile' | 'desktop';
    provider?: 'unlighthouse' | 'pagespeed';
    scores: AuditScores;
    audits: AuditItem[];
    fetchTime: string;
}

export interface ReportData {
    v: 1;
    project: string;
    url: string;
    ts: number;
    audit?: AuditResult;
    build?: { score: number; applied: number };
}

export interface AuditOptions {
    strategy: 'mobile' | 'desktop' | 'both';
    apiKey?: string;
    rootDir?: string;
}
