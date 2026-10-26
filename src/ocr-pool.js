import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
export class OCRPool {
  constructor({
    max = 2,
    timeout = 60000,
    workerPath = fileURLToPath(new URL("./ocr-worker.js", import.meta.url)),
  } = {}) {
    this.max = max;
    this.timeout = timeout;
    this.path = workerPath;
    this.slots = [];
  }
  run(path) {
    let slot = this.slots.find((s) => !s.busy);
    if (!slot) {
      if (this.slots.length >= this.max)
        return Promise.reject(Error("OCR pool full"));
      const env = {};
      for (const k of [
        "SystemRoot",
        "WINDIR",
        "PATH",
        "TEMP",
        "TMP",
        "HOME",
        "LOCALAPPDATA",
      ])
        if (process.env[k]) env[k] = process.env[k];
      const child = fork(this.path, ["--service"], {
        execArgv: ["--max-old-space-size=384"],
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        env,
      });
      slot = { child, busy: false, jobs: 0 };
      this.slots.push(slot);
      child.on("exit", () => {
        this.slots = this.slots.filter((s) => s !== slot);
        slot.reject?.(Error("OCR worker exited"));
      });
      child.on("error", () => slot.reject?.(Error("OCR worker unavailable")));
    }
    slot.busy = true;
    return new Promise((resolve, reject) => {
      const finish = (err, result) => {
        clearTimeout(timer);
        slot.child.removeListener("message", receive);
        slot.reject = null;
        slot.busy = false;
        slot.jobs++;
        if (err || slot.jobs >= 25) {
          slot.child.kill();
          this.slots = this.slots.filter((s) => s !== slot);
        }
        err ? reject(err) : resolve(result);
      };
      const receive = (m) =>
        finish(m.error ? Error("OCR recognition failed") : null, m.result);
      const timer = setTimeout(
        () => finish(Error("OCR timed out")),
        this.timeout,
      );
      slot.reject = (e) => finish(e);
      slot.child.once("message", receive);
      slot.child.send({ path });
    });
  }
  close() {
    for (const s of this.slots) {
      s.reject?.(Error("OCR pool closed"));
      s.child.kill();
    }
    this.slots = [];
  }
}
