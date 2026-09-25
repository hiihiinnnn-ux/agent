import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export class AuditLogger {
  constructor(filePath = resolve("data", "audit.jsonl")) {
    this.filePath = filePath;
    mkdirSync(dirname(this.filePath), { recursive: true });
  }

  record(event) {
    const line = JSON.stringify({ at: new Date().toISOString(), ...event });
    appendFileSync(this.filePath, `${line}\n`, { encoding: "utf8", mode: 0o600 });
  }
}
