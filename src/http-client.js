export async function readBoundedJSON(response, maxBytes) {
  if (Number(response.headers.get("content-length")) > maxBytes)
    throw Error("Provider response exceeds size bound");
  const reader = response.body?.getReader();
  if (!reader) throw Error("Missing provider response body");
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) throw Error("Provider response exceeds size bound");
      chunks.push(Buffer.from(value));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock();
  }
}
