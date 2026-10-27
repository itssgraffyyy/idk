// Segment only explicit recognized labels; never consult declarations or truth.
export function segmentRecognizedLabels(text, aliases) {
  const labels = Object.values(aliases)
    .map((v) => "(?:" + v + ")")
    .join("|");
  const marker = new RegExp("(?:^|\\s+)(?:" + labels + ")\\s*[:=]\\s*", "gi");
  return String(text)
    .split(/\r?\n/)
    .flatMap((line) => {
      const matches = [...line.matchAll(marker)];
      if (matches.length < 2) return [line];
      const segments = [];
      if (matches[0].index > 0 && line.slice(0, matches[0].index).trim())
        segments.push(line.slice(0, matches[0].index));
      for (let i = 0; i < matches.length; i++)
        segments.push(
          line
            .slice(matches[i].index, matches[i + 1]?.index ?? line.length)
            .trim(),
        );
      return segments;
    })
    .join("\n");
}
export function recognizedSegmentWords(line, segment) {
  const target = segment.normalize("NFKC").replace(/\s+/g, ""),
    words = line?.words || [];
  for (let start = 0; start < words.length; start++) {
    let value = "";
    for (let end = start; end < Math.min(start + 60, words.length); end++) {
      value += String(words[end].text || "")
        .normalize("NFKC")
        .replace(/\s+/g, "");
      if (value === target) return words.slice(start, end + 1);
      if (!target.startsWith(value)) break;
    }
  }
  return [];
}
export function recognizedValueWords(line, segment, rawValue) {
  const words = recognizedSegmentWords(line, segment),
    separator = words.findIndex((w) => /[:=]$/.test(w.text || ""));
  if (separator < 0) return [];
  return recognizedSegmentWords(
    { words: words.slice(separator + 1) },
    rawValue,
  );
}
export function unionOCRBoxes(items) {
  const boxes = items
    .map((v) => v.bbox)
    .filter(
      (b) =>
        b &&
        [b.x0, b.y0, b.x1, b.y1].every(Number.isFinite) &&
        b.x1 > b.x0 &&
        b.y1 > b.y0,
    );
  if (!boxes.length || boxes.length !== items.length) return null;
  return {
    x0: Math.min(...boxes.map((b) => b.x0)),
    y0: Math.min(...boxes.map((b) => b.y0)),
    x1: Math.max(...boxes.map((b) => b.x1)),
    y1: Math.max(...boxes.map((b) => b.y1)),
  };
}
