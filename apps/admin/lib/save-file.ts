/** A base64 file from the server saved in the browser (client components only). */
export function saveFile(f: { filename: string; contentType: string; base64: string }) {
  const bytes = Uint8Array.from(atob(f.base64), (ch) => ch.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: f.contentType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = f.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
