export enum TaskOverlapStrategy {
    Skip = "skip",
    Queue = "queue",
    Parallel = "parallel",
}

export enum TaskStatus {
    Registered = "registered",
    Scheduled = "scheduled",
    Running = "running",
    Stopped = "stopped",
    Failed = "failed",
}

export enum TaskRetryStrategy {
    Fixed = "fixed",
    Exponential = "exponential",
}

export enum TaskTriggerKind {
    Cron = "cron",
    Manual = "manual",
}
