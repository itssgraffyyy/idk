// Benchmark-only IPC instrumentation. Production recognition remains unchanged.
import { pathToFileURL } from "node:url";
const send = process.send.bind(process);
let job;
process.on("message", (message) => {
  job = {
    id: message.benchmarkId,
    start: performance.now(),
    before: process.resourceUsage(),
  };
});
process.send = (message, ...rest) => {
  if (!job) return send(message, ...rest);
  const after = process.resourceUsage();
  const result = {
    ...message,
    benchmark: {
      id: job.id,
      elapsedMs: performance.now() - job.start,
      userCPUTimeMicroseconds: after.userCPUTime - job.before.userCPUTime,
      systemCPUTimeMicroseconds: after.systemCPUTime - job.before.systemCPUTime,
      peakRSSKiB: after.maxRSS > 0 ? after.maxRSS : null,
      rssBytes: process.memoryUsage().rss,
    },
  };
  job = null;
  return send(result, ...rest);
};
await import(pathToFileURL(process.argv[3]).href);
send({
  benchmarkReady: true,
  resources: process.resourceUsage(),
  memory: process.memoryUsage(),
});
