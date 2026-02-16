import { Task } from "./task";
import type { CreatedTask, TaskConfig, TaskId } from "./types";

/** Create a {@link Task} from a config object. Throws if `id` is empty. */
export function createTask<TId extends TaskId, TPayload = void>(
    config: TaskConfig<TId, TPayload>,
): CreatedTask<TId, TPayload> {
    if (!config.id || config.id.trim().length === 0) throw new Error("createTask: id is required");
    return new Task(config);
}
