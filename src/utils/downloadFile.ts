/** Save `text` as a file through the blob + anchor pattern (works from `file://`). */
export function downloadText(text: string, filename: string, type = "application/json;charset=utf-8"): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Save `blob` as a file through the anchor pattern (works from `file://`). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/** Save `data` as pretty-printed JSON. */
export function downloadJson(data: unknown, filename: string): void {
  downloadText(JSON.stringify(data, null, 2), filename);
}
