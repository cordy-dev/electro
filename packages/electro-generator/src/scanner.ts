/**
 * AST Scanner — OXC-based feature/service discovery.
 *
 * Parses TypeScript source files with OXC and extracts metadata from
 * `createFeature()` and `createService()` calls. Only string literals
 * are extracted; computed or dynamic values are skipped with a warning.
 *
 * Uses node:fs + tinyglobby (cross-runtime: works in Bun and vitest workers).
 */

import { readFileSync } from "node:fs";
import type { CallExpression, VariableDeclarator } from "oxc-parser";
import { parseSync, Visitor } from "oxc-parser";
import type { ScannedEvent, ScannedFeature, ScannedService, ScannedTask, ScanResult } from "./types";

// ── File filtering ──────────────────────────────────────────────────

const EXCLUDE_PATTERNS = [/\.d\.ts$/, /\.test\.ts$/, /\.spec\.ts$/, /\.gen\.ts$/];

function shouldInclude(filePath: string): boolean {
    return filePath.endsWith(".ts") && !EXCLUDE_PATTERNS.some((p) => p.test(filePath));
}

// ── AST helpers ─────────────────────────────────────────────────────

type ASTNode = Record<string, unknown>;

/** Extract a string literal value from an AST node. Returns null for non-literals. */
function getStringLiteral(node: ASTNode | null | undefined): string | null {
    if (!node) return null;
    if (node.type === "Literal" && typeof node.value === "string") {
        return node.value;
    }
    return null;
}

/** Extract an array of string literals from an ArrayExpression node. */
function getStringArray(node: ASTNode | null | undefined): string[] {
    if (!node || node.type !== "ArrayExpression") return [];
    const elements = node.elements as (ASTNode | null)[];
    const result: string[] = [];
    for (const el of elements) {
        const val = getStringLiteral(el);
        if (val !== null) result.push(val);
    }
    return result;
}

/** Get a property value from an ObjectExpression by key name. */
function getObjectProperty(obj: ASTNode, key: string): ASTNode | null {
    const props = obj.properties as ASTNode[];
    for (const prop of props) {
        if (prop.type !== "Property") continue;
        const propKey = prop.key as ASTNode;
        if (propKey.type === "Identifier" && propKey.name === key) {
            return prop.value as ASTNode;
        }
    }
    return null;
}

/** Extract property names from an ObjectExpression (method names from api() return). */
function getPropertyNames(obj: ASTNode): string[] {
    const props = obj.properties as ASTNode[];
    const names: string[] = [];
    for (const prop of props) {
        if (prop.type !== "Property") continue;
        const key = prop.key as ASTNode;
        if (key.type === "Identifier" && typeof key.name === "string") {
            names.push(key.name);
        }
    }
    return names;
}

/**
 * Extract method names from the `api` property.
 *
 * Handles:
 * - `api: () => ({ method1() {}, method2() {} })`       — arrow with parens
 * - `api: () => { return { method1() {}, method2() {} } }` — arrow with block
 * - `api(): Type { return { ... } }`                     — method shorthand
 */
function extractMethodsFromApi(apiNode: ASTNode): string[] {
    // Arrow function: () => expr or () => { ... }
    if (apiNode.type === "ArrowFunctionExpression") {
        let body = apiNode.body as ASTNode;
        // OXC wraps `() => ({...})` in ParenthesizedExpression
        if (body.type === "ParenthesizedExpression") {
            body = body.expression as ASTNode;
        }
        // Expression body: () => ({ ... })
        if (body.type === "ObjectExpression") {
            return getPropertyNames(body);
        }
        // Block body: () => { return { ... } }
        if (body.type === "BlockStatement") {
            return extractMethodsFromBlock(body);
        }
    }

    // Regular function expression: function() { return { ... } }
    if (apiNode.type === "FunctionExpression") {
        return extractMethodsFromBlock(apiNode.body as ASTNode);
    }

    return [];
}

/** Find the first return statement with an object literal in a block. */
function extractMethodsFromBlock(block: ASTNode): string[] {
    const stmts = block.body as ASTNode[];
    for (const stmt of stmts) {
        if (stmt.type === "ReturnStatement") {
            const arg = stmt.argument as ASTNode | null;
            if (arg?.type === "ObjectExpression") {
                return getPropertyNames(arg);
            }
        }
    }
    return [];
}

// ── Scope resolution ────────────────────────────────────────────────

/**
 * Resolve the scope value from an AST node.
 *
 * Handles:
 * - `ServiceScope.EXPOSED` (MemberExpression)
 * - `"exposed"` (string literal)
 */
function resolveScope(node: ASTNode): string | null {
    // String literal: "exposed"
    const literal = getStringLiteral(node);
    if (literal) return literal;

    // Member expression: ServiceScope.EXPOSED
    if (node.type === "MemberExpression" && node.computed === false) {
        const prop = node.property as ASTNode;
        const name = (prop.name as string).toUpperCase();
        const MAP: Record<string, string> = {
            EXPOSED: "exposed",
            INTERNAL: "internal",
            PRIVATE: "private",
        };
        return MAP[name] ?? null;
    }

    return null;
}

// ── Event extraction ────────────────────────────────────────────────

/**
 * Extract published event names from a file's AST.
 * Looks for `ctx.events.publish("eventName", ...)` patterns.
 */
function extractPublishedEvents(program: ASTNode): string[] {
    const events: string[] = [];

    const visitor = new Visitor({
        CallExpression(node: CallExpression) {
            const callee = node.callee as ASTNode;
            // ctx.events.publish(...)
            if (
                callee.type === "MemberExpression" &&
                callee.computed === false &&
                (callee.property as ASTNode).type === "Identifier" &&
                (callee.property as ASTNode).name === "publish"
            ) {
                const obj = callee.object as ASTNode;
                if (
                    obj.type === "MemberExpression" &&
                    obj.computed === false &&
                    (obj.property as ASTNode).type === "Identifier" &&
                    (obj.property as ASTNode).name === "events"
                ) {
                    const args = node.arguments as ASTNode[];
                    if (args.length > 0) {
                        const eventName = getStringLiteral(args[0]);
                        if (eventName) events.push(eventName);
                    }
                }
            }
        },
    });

    visitor.visit(program as Parameters<typeof visitor.visit>[0]);
    return events;
}

// ── Export detection ────────────────────────────────────────────────

/**
 * Walk the program body and collect variable names that appear in
 * `export` declarations (ExportNamedDeclaration with VariableDeclaration).
 */
function extractExportedNames(program: ASTNode): Set<string> {
    const names = new Set<string>();
    const body = program.body as ASTNode[] | undefined;
    if (!body) return names;

    for (const node of body) {
        if (node.type !== "ExportNamedDeclaration") continue;
        const declaration = node.declaration as ASTNode | null;

        if (declaration?.type === "VariableDeclaration") {
            // export const x = ...
            const declarators = declaration.declarations as ASTNode[];
            for (const decl of declarators) {
                const id = decl.id as ASTNode | null;
                if (id?.type === "Identifier" && typeof id.name === "string") {
                    names.add(id.name);
                }
            }
        } else if (!declaration) {
            // export { x } — re-export with specifiers, no declaration
            const specifiers = node.specifiers as ASTNode[] | undefined;
            if (specifiers) {
                for (const spec of specifiers) {
                    if (spec.type !== "ExportSpecifier") continue;
                    const local = spec.local as ASTNode | null;
                    if (local?.type === "Identifier" && typeof local.name === "string") {
                        names.add(local.name);
                    }
                }
            }
        }
    }

    return names;
}

// ── Service scanning ────────────────────────────────────────────────

interface PendingService {
    varName: string;
    service: ScannedService;
}

/**
 * Extract createService() calls from a file.
 * Uses VariableDeclarator to capture `const x = createService({...})` patterns.
 * Returns services keyed by their variable name for later resolution.
 */
function extractServices(program: ASTNode, filePath: string, exportedNames: Set<string>): PendingService[] {
    const services: PendingService[] = [];

    const visitor = new Visitor({
        VariableDeclarator(node: VariableDeclarator) {
            const init = node.init as ASTNode | null;
            if (!init || init.type !== "CallExpression") return;

            const callee = init.callee as ASTNode;
            if (callee.type !== "Identifier" || callee.name !== "createService") return;

            const args = init.arguments as ASTNode[];
            if (args.length < 1 || args[0].type !== "ObjectExpression") return;
            const config = args[0];

            const id = getStringLiteral(getObjectProperty(config, "id"));
            if (!id) {
                console.warn(`[scanner] Skipping createService() with non-literal id in ${filePath}`);
                return;
            }

            const scopeNode = getObjectProperty(config, "scope");
            const scope = scopeNode ? resolveScope(scopeNode) : null;
            if (!scope) {
                console.warn(`[scanner] Skipping createService("${id}") with unresolvable scope in ${filePath}`);
                return;
            }

            const apiNode = getObjectProperty(config, "api");
            const methods = apiNode ? extractMethodsFromApi(apiNode) : [];
            if (apiNode && methods.length === 0) {
                console.warn(`[scanner] createService("${id}") api() didn't return an object literal in ${filePath}`);
            }

            // Capture variable name from declarator id
            const idNode = node.id as ASTNode;
            const varName = idNode.type === "Identifier" && typeof idNode.name === "string" ? idNode.name : id;

            services.push({
                varName,
                service: { id, scope, methods, filePath, varName, exported: exportedNames.has(varName) },
            });
        },
    });

    visitor.visit(program as Parameters<typeof visitor.visit>[0]);
    return services;
}

// ── Task scanning ──────────────────────────────────────────────────

interface PendingTask {
    varName: string;
    task: ScannedTask;
}

/**
 * Extract createTask() calls from a file.
 * Uses VariableDeclarator to capture `const x = createTask({...})` patterns.
 * Returns tasks keyed by their variable name for later resolution.
 */
function extractTasks(program: ASTNode, filePath: string, exportedNames: Set<string>): PendingTask[] {
    const tasks: PendingTask[] = [];

    const visitor = new Visitor({
        VariableDeclarator(node: VariableDeclarator) {
            const init = node.init as ASTNode | null;
            if (!init || init.type !== "CallExpression") return;

            const callee = init.callee as ASTNode;
            if (callee.type !== "Identifier" || callee.name !== "createTask") return;

            const args = init.arguments as ASTNode[];
            if (args.length < 1 || args[0].type !== "ObjectExpression") return;
            const config = args[0];

            const id = getStringLiteral(getObjectProperty(config, "id"));
            if (!id) {
                console.warn(`[scanner] Skipping createTask() with non-literal id in ${filePath}`);
                return;
            }

            // Capture variable name from declarator id
            const idNode = node.id as ASTNode;
            const varName = idNode.type === "Identifier" && typeof idNode.name === "string" ? idNode.name : id;

            tasks.push({
                varName,
                task: { id, varName, filePath, exported: exportedNames.has(varName) },
            });
        },
    });

    visitor.visit(program as Parameters<typeof visitor.visit>[0]);
    return tasks;
}

// ── Event scanning ──────────────────────────────────────────────────

interface PendingEvent {
    varName: string;
    event: ScannedEvent;
}

/**
 * Extract createEvent() calls from a file.
 * Uses VariableDeclarator to capture `const x = createEvent(...)` patterns.
 */
function extractEvents(program: ASTNode, filePath: string, exportedNames: Set<string>): PendingEvent[] {
    const events: PendingEvent[] = [];

    const visitor = new Visitor({
        VariableDeclarator(node: VariableDeclarator) {
            const init = node.init as ASTNode | null;
            if (!init || init.type !== "CallExpression") return;

            const callee = init.callee as ASTNode;
            if (callee.type !== "Identifier" || callee.name !== "createEvent") return;

            const args = init.arguments as ASTNode[];
            if (args.length < 1) return;

            const id = getStringLiteral(args[0]);
            if (!id) {
                console.warn(`[scanner] Skipping createEvent() with non-literal id in ${filePath}`);
                return;
            }

            const idNode = node.id as ASTNode;
            const varName = idNode.type === "Identifier" && typeof idNode.name === "string" ? idNode.name : id;

            events.push({
                varName,
                event: { id, varName, filePath, exported: exportedNames.has(varName) },
            });
        },
    });

    visitor.visit(program as Parameters<typeof visitor.visit>[0]);
    return events;
}

// ── Feature scanning ────────────────────────────────────────────────

interface RawFeature {
    id: string;
    dependencies: string[];
    serviceVarNames: string[];
    taskVarNames: string[];
    eventVarNames: string[];
    publishedEvents: string[];
    filePath: string;
}

/** Extract createFeature() calls from a file. */
function extractFeatures(program: ASTNode, filePath: string): RawFeature[] {
    const features: RawFeature[] = [];
    const events = extractPublishedEvents(program);

    const visitor = new Visitor({
        CallExpression(node: CallExpression) {
            const callee = node.callee as ASTNode;

            // Match: createFeature({ id, dependencies, services })
            if (callee.type !== "Identifier" || callee.name !== "createFeature") return;

            const args = node.arguments as ASTNode[];
            if (args.length < 1 || args[0].type !== "ObjectExpression") return;

            const config = args[0];
            const id = getStringLiteral(getObjectProperty(config, "id"));
            if (!id) {
                console.warn(`[scanner] Skipping createFeature() with non-literal id in ${filePath}`);
                return;
            }

            const depsNode = getObjectProperty(config, "dependencies");
            const dependencies = getStringArray(depsNode);

            // Extract service variable references from the services array
            const servicesNode = getObjectProperty(config, "services");
            const serviceVarNames: string[] = [];
            if (servicesNode?.type === "ArrayExpression") {
                const elements = servicesNode.elements as (ASTNode | null)[];
                for (const el of elements) {
                    if (el?.type === "Identifier" && typeof el.name === "string") {
                        serviceVarNames.push(el.name);
                    }
                }
            }

            // Extract task variable references from the tasks array
            const tasksNode = getObjectProperty(config, "tasks");
            const taskVarNames: string[] = [];
            if (tasksNode?.type === "ArrayExpression") {
                const taskElements = tasksNode.elements as (ASTNode | null)[];
                for (const el of taskElements) {
                    if (el?.type === "Identifier" && typeof el.name === "string") {
                        taskVarNames.push(el.name);
                    }
                }
            }

            // Extract event variable references from the events array
            const eventsNode = getObjectProperty(config, "events");
            const eventVarNames: string[] = [];
            if (eventsNode?.type === "ArrayExpression") {
                const eventElements = eventsNode.elements as (ASTNode | null)[];
                for (const el of eventElements) {
                    if (el?.type === "Identifier" && typeof el.name === "string") {
                        eventVarNames.push(el.name);
                    }
                }
            }

            features.push({
                id,
                dependencies,
                serviceVarNames,
                taskVarNames,
                eventVarNames,
                publishedEvents: events,
                filePath,
            });
        },
    });

    visitor.visit(program as Parameters<typeof visitor.visit>[0]);
    return features;
}

// ── File discovery ──────────────────────────────────────────────────

async function discoverFiles(basePath: string): Promise<string[]> {
    const { globSync } = await import("tinyglobby");
    const paths = globSync(["**/*.ts"], { cwd: basePath, absolute: true, ignore: ["node_modules/**"] });
    return paths.filter(shouldInclude);
}

// ── Main scan function ──────────────────────────────────────────────

/**
 * Scan TypeScript source files and extract feature/service metadata.
 *
 * @param basePath - Root directory to scan (e.g., `./src`)
 * @returns Aggregated scan result with all discovered features and services.
 */
export async function scan(basePath: string): Promise<ScanResult> {
    const files = await discoverFiles(basePath);

    // Phase 1: Parse all files, collect services, tasks, events, and features
    const allServices: PendingService[] = [];
    const allTasks: PendingTask[] = [];
    const allEvents: PendingEvent[] = [];
    const allFeatures: RawFeature[] = [];

    for (const filePath of files) {
        const source = readFileSync(filePath, "utf-8");
        const result = parseSync(filePath, source, { sourceType: "module" });

        if (result.errors.length > 0) {
            for (const err of result.errors) {
                console.warn(`[scanner] Parse error in ${filePath}: ${err.message}`);
            }
        }

        const program = result.program as unknown as ASTNode;
        const exportedNames = extractExportedNames(program);
        const services = extractServices(program, filePath, exportedNames);
        const tasks = extractTasks(program, filePath, exportedNames);
        const events = extractEvents(program, filePath, exportedNames);
        const features = extractFeatures(program, filePath);

        allServices.push(...services);
        allTasks.push(...tasks);
        allEvents.push(...events);
        allFeatures.push(...features);
    }

    // Phase 2: Build service and task lookups by variable name
    const serviceByVarName = new Map<string, ScannedService>();
    for (const { varName, service } of allServices) {
        serviceByVarName.set(varName, service);
    }

    const taskByVarName = new Map<string, ScannedTask>();
    for (const { varName, task } of allTasks) {
        taskByVarName.set(varName, task);
    }

    const eventByVarName = new Map<string, ScannedEvent>();
    for (const { varName, event } of allEvents) {
        eventByVarName.set(varName, event);
    }

    // Phase 3: Resolve feature → service, task, and event references
    const scannedFeatures: ScannedFeature[] = allFeatures.map((raw) => {
        const services: ScannedService[] = [];
        for (const varName of raw.serviceVarNames) {
            const svc = serviceByVarName.get(varName);
            if (svc) {
                services.push(svc);
            } else {
                console.warn(
                    `[scanner] Feature "${raw.id}" references unknown service variable "${varName}" in ${raw.filePath}`,
                );
            }
        }

        const tasks: ScannedTask[] = [];
        for (const varName of raw.taskVarNames) {
            const task = taskByVarName.get(varName);
            if (task) {
                tasks.push(task);
            } else {
                console.warn(
                    `[scanner] Feature "${raw.id}" references unknown task variable "${varName}" in ${raw.filePath}`,
                );
            }
        }

        const resolvedEvents: ScannedEvent[] = [];
        for (const varName of raw.eventVarNames) {
            const evt = eventByVarName.get(varName);
            if (evt) {
                resolvedEvents.push(evt);
            } else {
                console.warn(
                    `[scanner] Feature "${raw.id}" references unknown event variable "${varName}" in ${raw.filePath}`,
                );
            }
        }

        return {
            id: raw.id,
            filePath: raw.filePath,
            dependencies: raw.dependencies,
            services,
            tasks,
            events: resolvedEvents,
            publishedEvents: raw.publishedEvents,
        };
    });

    return { features: scannedFeatures };
}
