import { createEvent } from "@cordy/electro";

export const readyEvent = createEvent("ready", { version: "0.0.0", startedAt: 0 });
