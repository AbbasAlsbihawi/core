/**
 * The request body as text, or null once it exceeds `maxBytes` (→ 413). Route Handlers have no
 * body limit of their own (nginx allows 10m): a declared Content-Length is rejected before anything
 * is read, and a chunked body is counted in bytes and cancelled as soon as it crosses the cap.
 */
export async function readBodyCapped(req: Request, maxBytes: number): Promise<string | null> {
  if (Number(req.headers.get('content-length')) > maxBytes) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
