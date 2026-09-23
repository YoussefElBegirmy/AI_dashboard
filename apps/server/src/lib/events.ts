import { EventEmitter } from "node:events";
import type { RunEvent } from "@aieval/shared";

/** In-process pub/sub for live run progress (worker runs inside the API process). */
class RunEventBus extends EventEmitter {
  publish(runId: string, event: RunEvent) {
    this.emit(runId, event);
  }
  subscribe(runId: string, fn: (e: RunEvent) => void) {
    this.on(runId, fn);
    return () => this.off(runId, fn);
  }
}

export const runEvents = new RunEventBus();
runEvents.setMaxListeners(1000);
