export type PackageManager = 'yarn' | 'npm';
export type Preset = 'safe' | 'aggressive';
export type FindingId =
    | 'filesystem-cache'
    | 'babel-loader-cache'
    | 'source-map-loader-exclude'
    | 'parallelism'
    | 'terser-minifier';

export interface ProjectContext {
    rootDir: string;
    packageJsonPath: string;
    webpackConfigPath: string;
    composerJsonPath?: string;
    packageManager: PackageManager;
    packageJson: Record<string, any>;
    composerJson?: Record<string, any>;
    isPterodactyl: boolean;
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
