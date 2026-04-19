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

    if (!(await fs.pathExists(webpackConfigPath))) {
        throw new Error(`Missing webpack.config.js in ${rootDir}`);
    }

    const packageJson = await fs.readJson(packageJsonPath);
    const composerJson = (await fs.pathExists(composerJsonPath)) ? await fs.readJson(composerJsonPath) : undefined;
    const packageManager = detectPackageManager(rootDir, packageJson);

    const hasResourcesScripts = await fs.pathExists(path.join(rootDir, 'resources', 'scripts'));
    const hasArtisan = await fs.pathExists(path.join(rootDir, 'artisan'));
    const hasLaravel = typeof composerJson?.require?.['laravel/framework'] === 'string';

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
    };
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
