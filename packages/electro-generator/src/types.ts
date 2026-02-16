/**
 * Codegen scan result types.
 *
 * These are the shapes the AST scanner produces and the generator consumes.
 * First iteration uses method names only — full type extraction is future work.
 */

export interface ScannedService {
    id: string;
    scope: string; // "exposed" | "internal" | "private"
    methods: string[];
    filePath: string;
    varName: string;
    exported: boolean;
}

export interface ScannedTask {
    id: string;
    varName: string;
    filePath: string;
    exported: boolean;
}

export interface ScannedEvent {
    id: string;
    varName: string;
    filePath: string;
    exported: boolean;
}

export interface ScannedFeature {
    id: string;
    filePath: string;
    dependencies: string[];
    services: ScannedService[];
    tasks: ScannedTask[];
    events: ScannedEvent[];
    publishedEvents: string[];
}

export interface ScanResult {
    features: ScannedFeature[];
}

export interface GeneratedFile {
    path: string; // relative to outputDir
    content: string;
}
