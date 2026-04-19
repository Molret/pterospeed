import fs from 'fs-extra';
import path from 'node:path';
import type { PackageManager, ProjectContext } from './types';

export async function loadProject(inputPath?: string): Promise<ProjectContext> {
    const rootDir = path.resolve(inputPath || process.cwd());
    const packageJsonPath = path.join(rootDir, 'package.json');
    const webpackConfigPath = path.join(rootDir, 'webpack.config.js');
    const composerJsonPath = path.join(rootDir, 'composer.json');

    if (!(await fs.pathExists(packageJsonPath))) {
        throw new Error(`Missing package.json in ${rootDir}`);
    }

    const hasVite =
        (await fs.pathExists(path.join(rootDir, 'vite.config.ts'))) ||
        (await fs.pathExists(path.join(rootDir, 'vite.config.js')));
    const hasWebpack = await fs.pathExists(webpackConfigPath);

    if (hasVite && !hasWebpack) {
        throw new Error(
            'This project uses Vite, which is already fast. pterospeed targets webpack-based panels.\n' +
                'Vite support is on the roadmap for v0.2.',
        );
    }

    if (!hasWebpack) {
        throw new Error(`Missing webpack.config.js in ${rootDir}`);
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const composerJson = (await fs.pathExists(composerJsonPath)) ? await fs.readJson(composerJsonPath) : undefined;
    const packageManager = detectPackageManager(rootDir, packageJson);
    const webpackMajor = detectWebpackMajor(packageJson);

    const hasResourcesScripts = await fs.pathExists(path.join(rootDir, 'resources', 'scripts'));
    const hasArtisan = await fs.pathExists(path.join(rootDir, 'artisan'));
    const hasLaravel = typeof composerJson?.require?.['laravel/framework'] === 'string';
    const sourceFileCount = await countSourceFiles(rootDir);

    const isPterodactyl =
        packageJson?.name === 'pterodactyl-panel' ||
        composerJson?.name === 'pterodactyl/panel' ||
        composerJson?.name === 'pelican/panel' ||
        (hasResourcesScripts && hasArtisan && hasLaravel) ||
        Boolean(packageJson?.scripts?.['build:production'] && packageJson?.scripts?.build);

    return {
        rootDir,
        packageJsonPath,
        webpackConfigPath,
        composerJsonPath: composerJson ? composerJsonPath : undefined,
        packageManager,
        packageJson,
        composerJson,
        isPterodactyl,
        webpackMajor,
        sourceFileCount,
    };
}

async function countSourceFiles(rootDir: string): Promise<number> {
    const candidates = [
        path.join(rootDir, 'resources', 'scripts'),
        path.join(rootDir, 'src'),
        path.join(rootDir, 'assets'),
    ];
    const exts = new Set(['.js', '.jsx', '.ts', '.tsx']);
    let total = 0;

    for (const candidate of candidates) {
        if (!(await fs.pathExists(candidate))) {
            continue;
        }
        total += await walkCount(candidate, exts);
    }

    return total;
}

async function walkCount(dir: string, exts: Set<string>): Promise<number> {
    let total = 0;
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) {
                continue;
            }
            total += await walkCount(fullPath, exts);
            continue;
        }

        if (exts.has(path.extname(entry.name))) {
            total += 1;
        }
    }

    return total;
}

function detectWebpackMajor(packageJson: Record<string, any>): number {
    const all = { ...packageJson?.dependencies, ...packageJson?.devDependencies };
    const raw = String(all?.webpack ?? '');
    const match = raw.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 5;
}

function detectPackageManager(rootDir: string, packageJson: Record<string, any>): PackageManager {
    const declared = String(packageJson?.packageManager || '');
    if (declared.startsWith('yarn@')) {
        return 'yarn';
    }

    if (fs.existsSync(path.join(rootDir, 'yarn.lock'))) {
        return 'yarn';
    }

    return 'npm';
}

export function pterospeedDir(project: ProjectContext): string {
    return path.join(project.rootDir, '.pterospeed');
}

export function stateFile(project: ProjectContext): string {
    return path.join(pterospeedDir(project), 'state.json');
}

export function rel(project: ProjectContext, filePath: string): string {
    return path.relative(project.rootDir, filePath) || '.';
}
