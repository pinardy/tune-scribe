/** Saves generated data as a file through a temporary link. */
export function downloadFile(filename: string, data: string | Uint8Array, mimeType: string): void {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A title turned into something safe to use as a file name. */
export function fileStem(title: string): string {
  const stem = title
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || 'tune';
}
