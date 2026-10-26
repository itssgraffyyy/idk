import { PNG } from "pngjs";
import jpeg from "jpeg-js";
export function validateImage(bytes, mime) {
  if (mime === "image/png") {
    if (bytes.length < 33) throw Error("Truncated PNG");
    const w = bytes.readUInt32BE(16),
      h = bytes.readUInt32BE(20);
    if (!w || !h || w * h > 10000000)
      throw Error("Image dimensions exceed limit");
    PNG.sync.read(bytes, { checkCRC: true });
  } else
    jpeg.decode(bytes, {
      maxResolutionInMP: 10,
      maxMemoryUsageInMB: 96,
      tolerantDecoding: false,
    });
}
export function rotatePNG(bytes) {
  const input = PNG.sync.read(bytes),
    out = new PNG({ width: input.height, height: input.width });
  for (let y = 0; y < input.height; y++)
    for (let x = 0; x < input.width; x++) {
      const source = (y * input.width + x) * 4,
        target = (x * out.width + (out.width - 1 - y)) * 4;
      input.data.copy(out.data, target, source, source + 4);
    }
  return PNG.sync.write(out);
}
