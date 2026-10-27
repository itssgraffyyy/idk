// Benchmark-only preload: resource usage belongs to this child, not its parent.
process.on("exit", () =>
  process.stderr.write(
    "\nPREVIEW_RESOURCE_USAGE:" +
      JSON.stringify(process.resourceUsage()) +
      "\n",
  ),
);
