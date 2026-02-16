import { createEvent } from "@cordy/electro";

export const loadedEvent = createEvent<{ count: number }>("loaded");
