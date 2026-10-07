/** The folder beside the document that pasted images are saved in. */
export const imageFolder = "images";

/** The largest pasted image a host saves, in bytes. */
export const maxImageBytes = 50 * 1024 * 1024;

/** True when `bytes` starts with `signature`, from `offset`. */
function startsWith(bytes: Uint8Array, signature: string, offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let k = 0; k < signature.length; k++) if (bytes[offset + k] !== signature.charCodeAt(k)) return false;
  return true;
}

/** The file extension of the image in `bytes`, read from its signature; null when it is not a PNG, JPEG, GIF or WebP image. */
export function imageExtension(bytes: Uint8Array): "png" | "jpg" | "gif" | "webp" | null {
  if (startsWith(bytes, "\x89PNG\r\n\x1a\n")) return "png";
  if (startsWith(bytes, "\xff\xd8\xff")) return "jpg";
  if (startsWith(bytes, "GIF87a") || startsWith(bytes, "GIF89a")) return "gif";
  if (startsWith(bytes, "RIFF") && startsWith(bytes, "WEBP", 8)) return "webp";
  return null;
}

/**
 * The id and data of a `saveImage` message from the editor: an integer id and base64 data of at
 * most `maxImageBytes` bytes. Null for any other message. `message` is untrusted.
 */
export function saveImageRequest(message: unknown): { id: number; data: string } | null {
  if (typeof message !== "object" || message === null) return null;
  const m = message as { type?: unknown; id?: unknown; data?: unknown };
  if (m.type !== "saveImage" || typeof m.id !== "number" || !Number.isInteger(m.id) || typeof m.data !== "string") {
    return null;
  }
  const { id, data } = m;
  if (data.length % 4 !== 0 || data.length > Math.ceil(maxImageBytes / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) {
    return null;
  }
  return { id, data };
}
