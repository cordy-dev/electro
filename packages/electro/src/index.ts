// ── Config (build-time) ──────────────────────────────────────────────
export { defineConfig } from "./config/define-config";
export { defineRuntime } from "./config/define-runtime";
export { defineWindow } from "./config/define-window";
export type {
    DefineConfigInput,
    DefineRuntimeInput,
    DefineWindowInput,
    ElectroConfig,
    RuntimeDefinition,
    WindowBehavior,
    WindowCloseBehavior,
    WindowDefinition,
    WindowLifecycle,
    WindowType,
} from "./config/types";
// ── Logger ──────────────────────────────────────────────────────────
export type { LogEntry, LogHandler } from "./core/logger/types";
// ── Events ──────────────────────────────────────────────────────────
export { EventAccessor } from "./core/event-bus/accessor";
export { createEvent } from "./core/event-bus/helpers";
export type { CreatedEvent, EventHandler, EventId, EventInstance, EventSubscription } from "./core/event-bus/types";
export { FeatureStatus } from "./core/feature/enums";
export type { FeatureHandle } from "./core/feature/handle";
// ── Feature ─────────────────────────────────────────────────────────
export { createFeature } from "./core/feature/helpers";
export type { FeatureConfig, FeatureContext, FeatureId } from "./core/feature/types";
export { RuntimeState } from "./core/runtime/enums";
// ── Runtime (kernel) ────────────────────────────────────────────────
export { createRuntime } from "./core/runtime/helpers";
export { Runtime } from "./core/runtime/runtime";
export type { RuntimeConfig } from "./core/runtime/types";
export { ServiceScope, ServiceStatus } from "./core/service/enums";
// ── Service ─────────────────────────────────────────────────────────
export { createService } from "./core/service/helpers";
export type { CreatedService, ServiceConfig, ServiceId, ServiceInfo } from "./core/service/types";
export { TaskOverlapStrategy, TaskRetryStrategy, TaskStatus } from "./core/task/enums";
export type { TaskHandle } from "./core/task/handle";
// ── Task ────────────────────────────────────────────────────────────
export { createTask } from "./core/task/helpers";
export type {
    CreatedTask,
    StopMode,
    TaskConfig,
    TaskExecutionContext,
    TaskId,
    TaskStatusInfo,
} from "./core/task/types";
// ── Type registries (populated by codegen via declaration merging) ──
export type {
    BaseContext,
    LoggerContext,
    FeatureMap,
    ServiceOwnerMap,
    TaskOwnerMap,
    TypedContext,
    WindowMap,
} from "./core/types";
// ── Policy ──────────────────────────────────────────────────────────
export { PolicyEngine } from "./policy/engine";
export { PolicyDecision } from "./policy/types";
export type { PolicyResult } from "./policy/types";
// ── Window ──────────────────────────────────────────────────────────
export type { ElectroWindow, WindowFactory, WindowInfo } from "./window/types";
