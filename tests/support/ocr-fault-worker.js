process.on("message", (m) => {
  if (m.path === "hang") return;
  if (m.path === "exit") process.exit(1);
  if (m.path === "bad") process.send({ error: true });
  else process.send({ result: { text: "recovered" } });
});
