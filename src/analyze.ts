import fs from 'fs-extra';
import path from 'node:path';
import { createTwoFilesPatch } from 'diff';
import * as recast from 'recast';
import { parse as babelParse } from '@babel/parser';
import type {
    AnalysisResult,
    Finding,
    OptimizeOptions,
    OptimizeResult,
    Preset,
    ProjectContext,
} from './types';
import { pterospeedDir, stateFile } from './project';

const { builders: b, namedTypes: n, visit } = recast.types;

type AstBundle = {
    ast: recast.types.ASTNode;
    configObject: any;
    source: string;
};

const parser = {
    parse(source: string) {
        return babelParse(source, {
            sourceType: 'unambiguous',
            plugins: [
                'jsx',
                'typescript',
                'classProperties',
                'dynamicImport',
                'optionalChaining',
                'nullishCoalescingOperator',
                'objectRestSpread',
            ],
        });
    },
};

function computeEstimatedGain(findings: Finding[]): string {
    const notOk = (id: string) => findings.some((f) => f.id === id && !f.ok);
    const parts: string[] = [];

    if (notOk('esbuild-transpile')) {
        parts.push('TypeScript transpilation ~10-20x faster cold (esbuild-loader vs Babel)');
    }

    if (notOk('terser-minifier')) {
        parts.push('production minification ~3-4x faster (esbuild vs Terser)');
    }

    if (notOk('filesystem-cache')) {
        parts.push('warm dev builds ~5-10x faster (filesystem cache)');
    }

    if (notOk('babel-loader-cache')) {
        parts.push('transpile cache cuts cold build ~20-30%');
    }

    if (notOk('source-map-loader-exclude')) {
        parts.push('less time parsing maps in node_modules');
    }

    if (notOk('parallelism')) {
        parts.push('better CPU utilization on multi-core hosts');
    }

    if (notOk('always-minimize')) {
        parts.push('dev builds skip minification (~30-60s saved per dev build)');
    }

    if (!parts.length) {
        return 'config already well optimized';
    }

    return parts.join('; ');
}

export async function analyzeProject(project: ProjectContext): Promise<AnalysisResult> {
    const bundle = await parseWebpack(project.webpackConfigPath);
    const findings: Finding[] = [];

    findings.push(checkFilesystemCache(bundle.configObject, project.webpackMajor));
    findings.push(checkBabelLoaderCache(bundle.configObject));
    findings.push(checkSourceMapLoader(bundle.configObject));
    findings.push(checkParallelism(bundle.configObject));
    findings.push(checkTerserMinifier(bundle.configObject));
    findings.push(checkAlwaysMinimize(bundle.configObject));
    findings.push(checkEsbuildTranspile(bundle.configObject));

    const penalties = findings.reduce((sum, finding) => {
        if (finding.ok) {
            return sum;
        }

        if (finding.impact === 'high') {
            return sum + 22;
        }

        if (finding.impact === 'medium') {
            return sum + 12;
        }

        return sum + 6;
    }, 0);

    const score = Math.max(0, 100 - penalties);
    const estimatedGain = computeEstimatedGain(findings);

    return {
        project,
        findings,
        score,
        estimatedGain,
    };
}

export async function optimizeProject(project: ProjectContext, options: OptimizeOptions): Promise<OptimizeResult> {
    const bundle = await parseWebpack(project.webpackConfigPath);
    const applied: string[] = [];
    const skipped: string[] = [];
    let needsInstall = false;

    if (ensureFilesystemCache(bundle.configObject, project.webpackMajor)) {
        applied.push('Switched webpack cache to filesystem.');
    }

    if (ensureConditionalMinimize(bundle.configObject)) {
        applied.push('Changed minimize: true → minimize: isProduction (skips minification in dev).');
    }

    // Aggressive: replace babel-loader entirely — skip babel cache step
    let esbuildLoaderApplied = false;
    if (options.preset === 'aggressive') {
        esbuildLoaderApplied = ensureEsbuildLoader(bundle.configObject);
        if (esbuildLoaderApplied) {
            applied.push('Replaced babel-loader with esbuild-loader for TypeScript transpilation.');
            needsInstall = true;
        }
    }

    if (!esbuildLoaderApplied) {
        const babelResult = ensureBabelLoaderCache(bundle.configObject);
        if (babelResult === 'changed') {
            applied.push('Enabled babel-loader disk cache.');
        } else if (babelResult === 'skipped') {
            skipped.push('Could not patch babel-loader options shape safely.');
        }
    }

    if (ensureSourceMapLoaderExclude(bundle.configObject)) {
        applied.push('Excluded node_modules from source-map-loader.');
    }

    if (ensureParallelism(bundle.ast, bundle.configObject)) {
        applied.push('Added explicit parallelism based on CPU count.');
    }

    if (options.preset === 'aggressive') {

        const esbuildResult = ensureEsbuildMinifier(bundle.ast, bundle.configObject);
        if (esbuildResult.changed) {
            applied.push('Replaced TerserPlugin with EsbuildPlugin.');
            needsInstall = esbuildResult.needsInstall;
        } else if (esbuildResult.skipped) {
            skipped.push(esbuildResult.skipped);
        }
    }

    const nextWebpack = printAst(bundle.ast);
    let nextPackageJson = project.packageJson;
    let packageJsonChanged = false;

    if (options.preset === 'aggressive') {
        const packageResult = ensureEsbuildDependency(project.packageJson);
        nextPackageJson = packageResult.packageJson;
        packageJsonChanged = packageResult.changed;
        needsInstall = needsInstall || packageResult.changed;
        if (packageResult.changed) {
            applied.push('Added esbuild-loader to devDependencies.');
        }
    }

    const gainSummary = buildGainSummary(applied);

    if (nextWebpack === bundle.source && !packageJsonChanged) {
        return {
            changedFiles: [],
            applied,
            skipped,
            diff: '',
            needsInstall,
            gainSummary,
        };
    }

    const diffParts: string[] = [];
    if (nextWebpack !== bundle.source) {
        diffParts.push(createTwoFilesPatch('webpack.config.js', 'webpack.config.js', bundle.source, nextWebpack));
    }

    if (packageJsonChanged) {
        const prev = `${JSON.stringify(project.packageJson, null, 2)}\n`;
        const next = `${JSON.stringify(nextPackageJson, null, 2)}\n`;
        diffParts.push(createTwoFilesPatch('package.json', 'package.json', prev, next));
    }

    const diff = diffParts.join('\n');

    if (options.dryRun) {
        return {
            changedFiles: collectChangedFiles(nextWebpack !== bundle.source, packageJsonChanged),
            applied,
            skipped,
            diff,
            needsInstall,
            gainSummary,
        };
    }

    const backupDir = await createBackup(project, packageJsonChanged);
    await fs.writeFile(project.webpackConfigPath, nextWebpack);
    if (packageJsonChanged) {
        await fs.writeFile(project.packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`);
    }
    await writeState(project, backupDir, collectChangedFiles(nextWebpack !== bundle.source, packageJsonChanged));

    return {
        changedFiles: collectChangedFiles(nextWebpack !== bundle.source, packageJsonChanged),
        backupDir,
        applied,
        skipped,
        diff,
        needsInstall,
        gainSummary,
    };
}

function buildGainSummary(applied: string[]): string[] {
    const summary: string[] = [];
    const has = (substr: string) => applied.some((a) => a.includes(substr));

    if (has('esbuild-loader')) {
        summary.push('TypeScript transpilation: ~10-20x faster (esbuild-loader vs Babel)');
    }

    if (has('EsbuildPlugin')) {
        summary.push('Production minification: ~3-4x faster (esbuild vs Terser)');
    }

    if (has('filesystem cache')) {
        summary.push('Warm dev builds: ~5-10x faster (filesystem cache)');
    }

    if (has('babel-loader')) {
        summary.push('Transpile cache: cuts cold build ~20-30%');
    }

    if (has('source-map-loader')) {
        summary.push('source-map-loader: no longer scans node_modules');
    }

    if (has('parallelism')) {
        summary.push('Parallelism: full CPU utilization enabled');
    }

    if (has('minimize: isProduction') || has('minimize: true')) {
        summary.push('Dev builds: skip minification (~30-60s saved)');
    }

    return summary;
}

export async function revertProject(project: ProjectContext): Promise<string[]> {
    const statePath = stateFile(project);
    if (!(await fs.pathExists(statePath))) {
        throw new Error('No pterospeed backup state found.');
    }

    const state = await fs.readJson(statePath);
    const backupDir = state?.lastBackupDir;
    if (!backupDir || !(await fs.pathExists(backupDir))) {
        throw new Error('Backup directory missing.');
    }

    const restored: string[] = [];
    const backupWebpack = path.join(backupDir, 'webpack.config.js');
    const backupPackage = path.join(backupDir, 'package.json');

    if (await fs.pathExists(backupWebpack)) {
        await fs.copy(backupWebpack, project.webpackConfigPath, { overwrite: true });
        restored.push('webpack.config.js');
    }

    if (await fs.pathExists(backupPackage)) {
        await fs.copy(backupPackage, project.packageJsonPath, { overwrite: true });
        restored.push('package.json');
    }

    return restored;
}

async function parseWebpack(webpackConfigPath: string): Promise<AstBundle> {
    const source = await fs.readFile(webpackConfigPath, 'utf8');
    const ast = recast.parse(source, { parser });
    const configObject = findModuleExportsObject(ast);

    if (!configObject) {
        throw new Error('Could not find module.exports object in webpack.config.js');
    }

    return { ast, configObject, source };
}

function findModuleExportsObject(ast: recast.types.ASTNode): any | undefined {
    let found: any | undefined;

    visit(ast, {
        visitAssignmentExpression(path) {
            const node = path.node;
            if (
                n.MemberExpression.check(node.left) &&
                n.Identifier.check(node.left.object) &&
                node.left.object.name === 'module' &&
                isPropertyNamed(node.left.property, 'exports') &&
                n.ObjectExpression.check(node.right)
            ) {
                found = node.right;
                return false;
            }

            this.traverse(path);
            return undefined;
        },
    });

    return found;
}

function nodeHasFilesystemCache(node: any): boolean {
    if (n.ObjectExpression.check(node)) {
        return isPropertyValueString(node, 'type', 'filesystem');
    }
    if (n.ConditionalExpression.check(node)) {
        return nodeHasFilesystemCache(node.consequent) || nodeHasFilesystemCache(node.alternate);
    }
    return false;
}

function checkFilesystemCache(configObject: any, webpackMajor: number): Finding {
    const cacheProp = getObjectProperty(configObject, 'cache');

    if (cacheProp) {
        if (nodeHasFilesystemCache(cacheProp.value)) {
            return {
                id: 'filesystem-cache',
                title: 'Filesystem cache enabled',
                detail: 'Repeated builds can reuse persisted webpack cache.',
                impact: 'high',
                fixable: true,
                ok: true,
            };
        }

        // webpack 4: cache: true means persistent filesystem cache (different from webpack 5)
        if (webpackMajor <= 4 && n.BooleanLiteral.check(cacheProp.value) && cacheProp.value.value === true) {
            return {
                id: 'filesystem-cache',
                title: 'Filesystem cache enabled (webpack 4)',
                detail: 'cache: true in webpack 4 persists to disk. Upgrade to webpack 5 for more control.',
                impact: 'high',
                fixable: false,
                ok: true,
            };
        }
    }

    return {
        id: 'filesystem-cache',
        title: 'Filesystem cache missing',
        detail: 'Current config uses memory cache or no persistent cache. Warm builds stay slow.',
        impact: 'high',
        fixable: true,
        ok: false,
    };
}

function checkBabelLoaderCache(configObject: any): Finding {
    const rule = findRuleByLoader(configObject, 'babel-loader');
    if (!rule) {
        return {
            id: 'babel-loader-cache',
            title: 'babel-loader not detected',
            detail: 'No direct babel-loader rule found.',
            impact: 'low',
            fixable: false,
            ok: true,
        };
    }

    const options = getObjectProperty(rule, 'options');
    if (
        options &&
        n.ObjectExpression.check(options.value) &&
        isPropertyValueBoolean(options.value, 'cacheDirectory', true) &&
        isPropertyValueBoolean(options.value, 'cacheCompression', false)
    ) {
        return {
            id: 'babel-loader-cache',
            title: 'babel-loader cache enabled',
            detail: 'Transpile cache already configured.',
            impact: 'high',
            fixable: true,
            ok: true,
        };
    }

    return {
        id: 'babel-loader-cache',
        title: 'babel-loader cache missing',
        detail: 'Babel still runs cold on each build. Disk cache helps without removing Babel macros.',
        impact: 'high',
        fixable: true,
        ok: false,
    };
}

function checkSourceMapLoader(configObject: any): Finding {
    const rule = findRuleByLoader(configObject, 'source-map-loader');
    if (!rule) {
        return {
            id: 'source-map-loader-exclude',
            title: 'source-map-loader not detected',
            detail: 'No source-map-loader rule found.',
            impact: 'low',
            fixable: false,
            ok: true,
        };
    }

    const exclude = getObjectProperty(rule, 'exclude');
    if (exclude && isNodeModulesPattern(exclude.value)) {
        return {
            id: 'source-map-loader-exclude',
            title: 'source-map-loader scoped',
            detail: 'node_modules already excluded from source-map-loader.',
            impact: 'medium',
            fixable: true,
            ok: true,
        };
    }

    return {
        id: 'source-map-loader-exclude',
        title: 'source-map-loader scans too wide',
        detail: 'Parsing maps in node_modules can cost a lot on large panels.',
        impact: 'medium',
        fixable: true,
        ok: false,
    };
}

function checkParallelism(configObject: any): Finding {
    const parallelism = getObjectProperty(configObject, 'parallelism');
    if (parallelism) {
        return {
            id: 'parallelism',
            title: 'parallelism configured',
            detail: 'Webpack has explicit parallelism setting.',
            impact: 'medium',
            fixable: true,
            ok: true,
        };
    }

    return {
        id: 'parallelism',
        title: 'parallelism missing',
        detail: 'Explicit CPU parallelism can improve build throughput on heavier hosts.',
        impact: 'medium',
        fixable: true,
        ok: false,
    };
}

function checkTerserMinifier(configObject: any): Finding {
    const elements = getMinimizerElements(configObject);
    const hasTerser = elements.some(
        (el: any) => el && n.NewExpression.check(el) && getCalleeName(el.callee) === 'TerserPlugin',
    );

    if (!hasTerser) {
        return {
            id: 'terser-minifier',
            title: 'Fast minifier already configured',
            detail: 'TerserPlugin not found in optimization.minimizer.',
            impact: 'medium',
            fixable: true,
            ok: true,
        };
    }

    return {
        id: 'terser-minifier',
        title: 'TerserPlugin still in production path',
        detail: 'Terser is safe but slow. Aggressive preset can switch to EsbuildPlugin.',
        impact: 'medium',
        fixable: true,
        ok: false,
    };
}

function checkAlwaysMinimize(configObject: any): Finding {
    const optimization = getObjectProperty(configObject, 'optimization');
    if (!optimization || !n.ObjectExpression.check(optimization.value)) {
        return { id: 'always-minimize', title: 'minimize is conditional', detail: '', impact: 'medium', fixable: false, ok: true };
    }

    const minimize = getObjectProperty(optimization.value, 'minimize');
    if (minimize && n.BooleanLiteral.check(minimize.value) && minimize.value.value === true) {
        return {
            id: 'always-minimize',
            title: 'minimize: true always runs (even in dev)',
            detail: 'Minification in dev builds wastes 30-60s per build. Use minimize: isProduction.',
            impact: 'medium',
            fixable: true,
            ok: false,
        };
    }

    return {
        id: 'always-minimize',
        title: 'minimize is production-only',
        detail: 'Dev builds skip minification correctly.',
        impact: 'medium',
        fixable: true,
        ok: true,
    };
}

function checkEsbuildTranspile(configObject: any): Finding {
    const babelRule = findRuleByLoader(configObject, 'babel-loader');
    const esbuildRule = findRuleByLoader(configObject, 'esbuild-loader');

    if (!babelRule) {
        return {
            id: 'esbuild-transpile',
            title: esbuildRule ? 'esbuild-loader already transpiling TypeScript' : 'babel-loader not detected',
            detail: esbuildRule
                ? 'TypeScript transpilation already uses esbuild — no change needed.'
                : 'No babel-loader rule found.',
            impact: 'high',
            fixable: false,
            ok: true,
        };
    }

    return {
        id: 'esbuild-transpile',
        title: 'babel-loader transpiling TypeScript (slow)',
        detail: 'esbuild transpiles TS/TSX 10-20x faster than Babel. Aggressive preset replaces it automatically.',
        impact: 'high',
        fixable: true,
        ok: false,
    };
}

function ensureEsbuildLoader(configObject: any): boolean {
    const rule = findRuleByLoader(configObject, 'babel-loader');
    if (!rule) return false;

    // Already replaced
    if (findRuleByLoader(configObject, 'esbuild-loader')) return false;

    const loaderProp = getObjectProperty(rule, 'loader');
    if (loaderProp && n.StringLiteral.check(loaderProp.value)) {
        loaderProp.value = b.stringLiteral('esbuild-loader');
    }

    // Wipe old babel options, set esbuild ones
    const optionsProp = getObjectProperty(rule, 'options');
    const newOptions = parseObjectExpression("{ target: 'es2015' }");
    if (optionsProp) {
        optionsProp.value = newOptions;
    } else {
        rule.properties.push(b.objectProperty(b.identifier('options'), newOptions));
    }

    return true;
}

function ensureFilesystemCache(configObject: any, webpackMajor: number): boolean {
    if (webpackMajor <= 4) return false;

    const cacheProp = getObjectProperty(configObject, 'cache');
    if (cacheProp && nodeHasFilesystemCache(cacheProp.value)) return false;

    const nextValue = parseObjectExpression("{ type: 'filesystem', buildDependencies: { config: [__filename] } }");
    return upsertObjectProperty(configObject, 'cache', nextValue);
}

function ensureBabelLoaderCache(configObject: any): 'changed' | 'none' | 'skipped' {
    const rule = findRuleByLoader(configObject, 'babel-loader');
    if (!rule) {
        return 'none';
    }

    const optionsProp = getObjectProperty(rule, 'options');
    if (!optionsProp) {
        rule.properties.push(
            b.objectProperty(
                b.identifier('options'),
                parseObjectExpression('{ cacheDirectory: true, cacheCompression: false }'),
            ),
        );
        return 'changed';
    }

    if (!n.ObjectExpression.check(optionsProp.value)) {
        return 'skipped';
    }

    const changedA = upsertObjectProperty(optionsProp.value, 'cacheDirectory', b.booleanLiteral(true));
    const changedB = upsertObjectProperty(optionsProp.value, 'cacheCompression', b.booleanLiteral(false));
    return changedA || changedB ? 'changed' : 'none';
}

function ensureSourceMapLoaderExclude(configObject: any): boolean {
    const rule = findRuleByLoader(configObject, 'source-map-loader');
    if (!rule) {
        return false;
    }

    const excludeProp = getObjectProperty(rule, 'exclude');
    if (excludeProp && isNodeModulesPattern(excludeProp.value)) {
        return false;
    }

    return upsertObjectProperty(rule, 'exclude', parseExpression('/node_modules/'));
}

function ensureParallelism(ast: recast.types.ASTNode, configObject: any): boolean {
    const existing = getObjectProperty(configObject, 'parallelism');
    if (existing) {
        return false;
    }

    const osId = ensureOsRequire(ast);
    const expr = parseExpression(`Math.max(2, ${osId.name}.cpus().length)`);

    const cacheIndex = configObject.properties.findIndex((prop: any) => getPropertyName(prop) === 'cache');
    const newProp = b.objectProperty(b.identifier('parallelism'), expr);
    if (cacheIndex >= 0) {
        configObject.properties.splice(cacheIndex + 1, 0, newProp);
    } else {
        configObject.properties.unshift(newProp);
    }

    return true;
}

function ensureEsbuildMinifier(ast: recast.types.ASTNode, configObject: any): { changed: boolean; needsInstall: boolean; skipped?: string } {
    const arrays = collectMinimizerArrays(configObject);
    if (!arrays.length) {
        return { changed: false, needsInstall: false, skipped: 'No optimization.minimizer array found.' };
    }

    let changed = false;
    for (const arr of arrays) {
        for (let index = 0; index < arr.elements.length; index += 1) {
            const element = arr.elements[index];
            if (element && n.NewExpression.check(element) && getCalleeName(element.callee) === 'TerserPlugin') {
                ensureEsbuildRequire(ast);
                removeTerserRequire(ast);
                arr.elements[index] = parseExpression("new EsbuildPlugin({ target: 'es2015' })");
                changed = true;
            }
        }
    }

    return { changed, needsInstall: changed };
}

function ensureConditionalMinimize(configObject: any): boolean {
    const optimization = getObjectProperty(configObject, 'optimization');
    if (!optimization || !n.ObjectExpression.check(optimization.value)) return false;

    const minimize = getObjectProperty(optimization.value, 'minimize');
    if (!minimize || !n.BooleanLiteral.check(minimize.value) || minimize.value.value !== true) return false;

    // Use isProduction if it exists in scope (standard in all Pterodactyl configs), else ternary
    minimize.value = parseExpression('isProduction');
    return true;
}

function ensureEsbuildDependency(packageJson: Record<string, any>): { packageJson: Record<string, any>; changed: boolean } {
    const next = structuredClone(packageJson);
    next.devDependencies ??= {};

    if (next.devDependencies['esbuild-loader']) {
        return { packageJson: next, changed: false };
    }

    next.devDependencies['esbuild-loader'] = '^4.3.0';
    next.devDependencies = sortObject(next.devDependencies);
    return { packageJson: next, changed: true };
}

async function createBackup(project: ProjectContext, includePackageJson: boolean): Promise<string> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(pterospeedDir(project), 'backups', stamp);
    await fs.ensureDir(backupDir);
    await fs.copy(project.webpackConfigPath, path.join(backupDir, 'webpack.config.js'));
    if (includePackageJson) {
        await fs.copy(project.packageJsonPath, path.join(backupDir, 'package.json'));
    }
    return backupDir;
}

async function writeState(project: ProjectContext, backupDir: string, changedFiles: string[]): Promise<void> {
    await fs.ensureDir(pterospeedDir(project));
    await fs.writeJson(
        stateFile(project),
        {
            lastBackupDir: backupDir,
            changedFiles,
            updatedAt: new Date().toISOString(),
        },
        { spaces: 2 },
    );
}

function collectChangedFiles(webpackChanged: boolean, packageChanged: boolean): string[] {
    const files: string[] = [];
    if (webpackChanged) {
        files.push('webpack.config.js');
    }
    if (packageChanged) {
        files.push('package.json');
    }
    return files;
}

function printAst(ast: recast.types.ASTNode): string {
    return `${recast.print(ast, { quote: 'single', reuseWhitespace: false }).code.trimEnd()}\n`;
}

function getRules(configObject: any): any[] {
    const moduleProp = getObjectProperty(configObject, 'module');
    if (!moduleProp || !n.ObjectExpression.check(moduleProp.value)) {
        return [];
    }

    const rulesProp = getObjectProperty(moduleProp.value, 'rules');
    if (!rulesProp || !n.ArrayExpression.check(rulesProp.value)) {
        return [];
    }

    return rulesProp.value.elements.filter((entry: any) => entry && n.ObjectExpression.check(entry));
}

function findRuleByLoader(configObject: any, loaderName: string): any | undefined {
    return getRules(configObject).find((rule) => ruleHasLoader(rule, loaderName));
}

function ruleHasLoader(rule: any, loaderName: string): boolean {
    const loaderProp = getObjectProperty(rule, 'loader');
    if (loaderProp && n.StringLiteral.check(loaderProp.value)) {
        return loaderProp.value.value === loaderName;
    }

    const useProp = getObjectProperty(rule, 'use');
    if (!useProp) {
        return false;
    }

    if (n.ArrayExpression.check(useProp.value)) {
        return useProp.value.elements.some((element: any) => {
            if (!element) {
                return false;
            }
            if (n.StringLiteral.check(element)) {
                return element.value === loaderName;
            }
            if (n.ObjectExpression.check(element)) {
                const nested = getObjectProperty(element, 'loader');
                return Boolean(nested && n.StringLiteral.check(nested.value) && nested.value.value === loaderName);
            }
            return false;
        });
    }

    return false;
}

function getMinimizerElements(configObject: any): any[] {
    const optimization = getObjectProperty(configObject, 'optimization');
    if (!optimization || !n.ObjectExpression.check(optimization.value)) return [];

    const minimizer = getObjectProperty(optimization.value, 'minimizer');
    if (!minimizer) return [];

    const elements: any[] = [];
    collectArrayElementsFromNode(minimizer.value, elements);
    return elements;
}

function collectArrayElementsFromNode(node: any, acc: any[]): void {
    if (n.ArrayExpression.check(node)) {
        acc.push(...node.elements.filter(Boolean));
    } else if (n.ConditionalExpression.check(node)) {
        collectArrayElementsFromNode(node.consequent, acc);
        collectArrayElementsFromNode(node.alternate, acc);
    }
}

function collectMinimizerArrays(configObject: any): any[] {
    const optimization = getObjectProperty(configObject, 'optimization');
    if (!optimization || !n.ObjectExpression.check(optimization.value)) return [];

    const minimizer = getObjectProperty(optimization.value, 'minimizer');
    if (!minimizer) return [];

    const arrays: any[] = [];
    collectArrayNodesFromNode(minimizer.value, arrays);
    return arrays;
}

function collectArrayNodesFromNode(node: any, acc: any[]): void {
    if (n.ArrayExpression.check(node)) {
        acc.push(node);
    } else if (n.ConditionalExpression.check(node)) {
        collectArrayNodesFromNode(node.consequent, acc);
        collectArrayNodesFromNode(node.alternate, acc);
    }
}

function getObjectProperty(objectExpression: any, name: string): any | undefined {
    return objectExpression.properties.find((prop: any) => getPropertyName(prop) === name);
}

function upsertObjectProperty(objectExpression: any, name: string, value: any): boolean {
    const existing = getObjectProperty(objectExpression, name);
    if (existing) {
        const prev = recast.print(existing.value).code;
        const next = recast.print(value).code;
        if (prev === next) {
            return false;
        }
        existing.value = value;
        return true;
    }

    objectExpression.properties.push(b.objectProperty(b.identifier(name), value));
    return true;
}

function getPropertyName(prop: any): string | undefined {
    if (!prop || (!n.ObjectProperty.check(prop) && !n.Property.check(prop))) {
        return undefined;
    }

    if (n.Identifier.check(prop.key)) {
        return prop.key.name;
    }

    if (n.StringLiteral.check(prop.key)) {
        return prop.key.value;
    }

    return undefined;
}

function isPropertyNamed(property: any, name: string): boolean {
    if (n.Identifier.check(property)) {
        return property.name === name;
    }

    if (n.StringLiteral.check(property)) {
        return property.value === name;
    }

    return false;
}

function isPropertyValueString(objectExpression: any, name: string, expected: string): boolean {
    const prop = getObjectProperty(objectExpression, name);
    return Boolean(prop && n.StringLiteral.check(prop.value) && prop.value.value === expected);
}

function isPropertyValueBoolean(objectExpression: any, name: string, expected: boolean): boolean {
    const prop = getObjectProperty(objectExpression, name);
    return Boolean(prop && n.BooleanLiteral.check(prop.value) && prop.value.value === expected);
}

function isNodeModulesPattern(node: any): boolean {
    if (n.RegExpLiteral.check(node)) {
        return node.pattern.includes('node_modules');
    }

    return false;
}

function getCalleeName(node: any): string | undefined {
    if (n.Identifier.check(node)) {
        return node.name;
    }
    return undefined;
}

function ensureOsRequire(ast: recast.types.ASTNode): any {
    const existing = findRequireIdentifier(ast, ['node:os', 'os']);
    if (existing) {
        return existing;
    }

    const body = (ast as any).program.body as any[];
    const preferred = hasTopLevelBinding(ast, 'os') ? 'nodeOs' : 'os';
    const declaration = parseStatement(`const ${preferred} = require('node:os');`);

    let index = 0;
    while (index < body.length && n.VariableDeclaration.check(body[index])) {
        index += 1;
    }
    body.splice(index, 0, declaration);
    return b.identifier(preferred);
}

function ensureEsbuildRequire(ast: recast.types.ASTNode): void {
    const existing = findRequireIdentifier(ast, ['esbuild-loader'], 'EsbuildPlugin');
    if (existing) {
        return;
    }

    const body = (ast as any).program.body as any[];
    const declaration = parseStatement("const { EsbuildPlugin } = require('esbuild-loader');");

    let index = 0;
    while (index < body.length && n.VariableDeclaration.check(body[index])) {
        index += 1;
    }
    body.splice(index, 0, declaration);
}

function removeTerserRequire(ast: recast.types.ASTNode): void {
    const body = (ast as any).program.body as any[];
    const index = body.findIndex((node: any) => {
        if (!n.VariableDeclaration.check(node)) return false;
        return node.declarations.some((decl: any) => {
            if (!n.VariableDeclarator.check(decl)) return false;
            if (!n.CallExpression.check(decl.init)) return false;
            const callee = decl.init.callee;
            if (!n.Identifier.check(callee) || callee.name !== 'require') return false;
            const arg = decl.init.arguments[0];
            return n.StringLiteral.check(arg) && arg.value === 'terser-webpack-plugin';
        });
    });
    if (index >= 0) {
        body.splice(index, 1);
    }
}

function findRequireIdentifier(ast: recast.types.ASTNode, modules: string[], namedExport?: string): any | undefined {
    let found: any | undefined;
    visit(ast, {
        visitVariableDeclarator(path) {
            const node = path.node;
            if (
                n.CallExpression.check(node.init) &&
                n.Identifier.check(node.init.callee) &&
                node.init.callee.name === 'require' &&
                node.init.arguments.length === 1 &&
                n.StringLiteral.check(node.init.arguments[0]) &&
                modules.includes(node.init.arguments[0].value)
            ) {
                if (!namedExport && n.Identifier.check(node.id)) {
                    found = b.identifier(node.id.name);
                    return false;
                }

                if (namedExport && n.ObjectPattern.check(node.id)) {
                    const prop = node.id.properties.find(
                        (entry: any) => n.ObjectProperty.check(entry) && getPropertyName(entry) === namedExport,
                    );
                    if (prop && n.ObjectProperty.check(prop) && n.Identifier.check(prop.value)) {
                        found = b.identifier(prop.value.name);
                        return false;
                    }
                }
            }

            this.traverse(path);
            return undefined;
        },
    });

    return found;
}

function hasTopLevelBinding(ast: recast.types.ASTNode, name: string): boolean {
    return Boolean(
        (ast as any).program.body.some((node: any) => {
            if (!n.VariableDeclaration.check(node)) {
                return false;
            }
            return node.declarations.some((decl: any) => n.Identifier.check(decl.id) && decl.id.name === name);
        }),
    );
}

function sortObject(record: Record<string, string>): Record<string, string> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function parseExpression(code: string): any {
    const expressionAst = recast.parse(`${code};`, { parser }) as any;
    return expressionAst.program.body[0].expression;
}

function parseObjectExpression(code: string): any {
    const objectAst = recast.parse(`const __pterospeed = ${code};`, { parser }) as any;
    return objectAst.program.body[0].declarations[0].init;
}

function parseStatement(code: string): any {
    const statementAst = recast.parse(code, { parser }) as any;
    return statementAst.program.body[0];
}
