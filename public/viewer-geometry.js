globalThis.projectEvidenceBox = function (field, viewport) {
  if (!field?.bbox || field.page !== viewport.page || viewport.rotation)
    return null;
  const { x0, y0, x1, y1 } = field.bbox;
  if (x1 <= x0 || y1 <= y0) return null;
  if (
    ![x0, y0, x1, y1, viewport.width, viewport.height].every(Number.isFinite) ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return null;
  let points = [
    [x0, y0],
    [x0, y1],
    [x1, y0],
    [x1, y1],
  ];
  if (field.coordinateSystem === "pdf-points-bottom-left") {
    const t = viewport.transform;
    if (!Array.isArray(t) || t.length !== 6 || !t.every(Number.isFinite))
      return null;
    points = points.map(([x, y]) => [
      t[0] * x + t[2] * y + t[4],
      t[1] * x + t[3] * y + t[5],
    ]);
  } else if (field.coordinateSystem !== "raster-pixels-top-left") return null;
  const left = Math.max(0, Math.min(...points.map((p) => p[0]))),
    top = Math.max(0, Math.min(...points.map((p) => p[1]))),
    right = Math.min(viewport.width, Math.max(...points.map((p) => p[0]))),
    bottom = Math.min(viewport.height, Math.max(...points.map((p) => p[1])));
  return right > left && bottom > top
    ? { x: left, y: top, width: right - left, height: bottom - top }
    : null;
};
