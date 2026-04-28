// Icon resolution pipeline - resolves tool icons at evaluation time
// and caches them in KV so the frontend never hits external services at render time.
// Also extracts the dominant brand color from the icon for UI theming.

import type { Env } from '../types.js';
import { createLogger } from './logger.js';
import { chatCompletion } from './ai.js';

const log = createLogger('icons');
const KV_PREFIX = 'icon:';
const KV_TTL = 30 * 24 * 60 * 60; // 30 days

interface IconResolution {
  icon_url: string;
  icon_source: 'favicon' | 'image' | 'google' | 'clearbit';
}

/**
 * Resolve the best available icon URL for a tool.
 * Tries metadata favicon/image, Google Favicons, and Clearbit in order.
 */
export async function resolveIconUrl(
  metadata: Record<string, unknown>,
): Promise<IconResolution | null> {
  if (typeof metadata.favicon === 'string' && metadata.favicon) {
    return { icon_url: metadata.favicon, icon_source: 'favicon' };
  }
  if (typeof metadata.image === 'string' && metadata.image) {
    return { icon_url: metadata.image, icon_source: 'image' };
  }

  const website = typeof metadata.website === 'string' ? metadata.website : null;
  if (!website) return null;

  let hostname: string;
  try {
    hostname = new URL(website).hostname;
  } catch {
    return null;
  }

  try {
    const googleUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=128`;
    const resp = await fetch(googleUrl, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const contentType = resp.headers.get('content-type') || '';
      const buf = await resp.arrayBuffer();
      if (buf.byteLength > 200 && contentType.includes('image')) {
        return { icon_url: googleUrl, icon_source: 'google' };
      }
    }
  } catch {
    // fall through
  }

  try {
    const clearbitUrl = `https://logo.clearbit.com/${hostname}`;
    const resp = await fetch(clearbitUrl, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    if (resp.ok) {
      return { icon_url: clearbitUrl, icon_source: 'clearbit' };
    }
  } catch {
    // fall through
  }

  return null;
}

/**
 * Fetch an icon, cache in KV, and extract its dominant color.
 * Returns { cached, brandColor } - both optional.
 */
export async function cacheIconAndExtractColor(
  toolId: string,
  iconUrl: string,
  env: Env,
): Promise<{ cached: boolean; brandColor: string | null }> {
  try {
    const resp = await fetch(iconUrl, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return { cached: false, brandColor: null };

    const contentType = resp.headers.get('content-type') || 'image/png';
    const buf = await resp.arrayBuffer();

    if (buf.byteLength > 500_000 || buf.byteLength < 100)
      return { cached: false, brandColor: null };

    // Convert to base64 data URI for KV storage
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      // Loop bound is bytes.length, so bytes[i] is always defined.
      binary += String.fromCharCode(bytes[i] ?? 0);
    }
    const base64 = btoa(binary);
    const dataUri = `data:${contentType};base64,${base64}`;

    await env.AUTH_KV.put(`${KV_PREFIX}${toolId}`, dataUri, { expirationTtl: KV_TTL });

    // Extract dominant brand color from the PNG favicon
    let brandColor: string | null = null;
    if (contentType.includes('png')) {
      brandColor = await extractColorFromPNGAsync(bytes);
    }

    return { cached: true, brandColor };
  } catch (err) {
    log.warn(`Failed to cache icon for ${toolId}: ${(err as Error).message}`);
    return { cached: false, brandColor: null };
  }
}

/** Get a cached icon from KV. */
export async function getCachedIcon(toolId: string, env: Env): Promise<string | null> {
  return env.AUTH_KV.get(`${KV_PREFIX}${toolId}`, { cacheTtl: 86400 });
}

/**
 * Resolve, cache, and extract brand color for a tool evaluation.
 * Updates metadata in-place with icon_url, icon_source, icon_cached, brand_color.
 */
export async function resolveAndCacheIcon(
  toolId: string,
  metadata: Record<string, unknown>,
  env: Env,
): Promise<void> {
  const resolution = await resolveIconUrl(metadata);
  if (!resolution) return;

  metadata.icon_url = resolution.icon_url;
  metadata.icon_source = resolution.icon_source;

  const { cached, brandColor } = await cacheIconAndExtractColor(toolId, resolution.icon_url, env);
  metadata.icon_cached = cached;
  if (brandColor) metadata.brand_color = brandColor;
}

/**
 * Extract brand color from a cached KV icon (for batch backfill).
 * Reads the data URI from KV, decodes PNG, returns hex color.
 */
export async function extractBrandColorFromCache(toolId: string, env: Env): Promise<string | null> {
  const dataUri = await env.AUTH_KV.get(`${KV_PREFIX}${toolId}`);
  if (!dataUri || !dataUri.startsWith('data:image/png')) return null;

  const base64 = dataUri.split(',')[1];
  if (!base64) return null;

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return extractColorFromPNGAsync(bytes);
}

// ── Workers AI Color Extraction ──
// Uses Cloudflare Workers AI vision model to identify brand color from any image format.
// This is the primary color extraction method - handles PNG, JPEG, ICO, SVG, anything.

export async function extractColorWithAI(dataUri: string, env: Env): Promise<string | null> {
  const text = await chatCompletion(env.AI, {
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'What is the single most prominent brand color in this logo/icon? Reply with ONLY the hex color code in #rrggbb format. Nothing else. Example: #3b82f6',
          },
          {
            type: 'image_url',
            image_url: { url: dataUri },
          },
        ],
      },
    ],
    max_tokens: 20,
  });

  if (!text) return null;
  // Extract hex color from response - model might add extra text
  const match = text.match(/#[0-9a-fA-F]{6}/);
  return match ? match[0].toLowerCase() : null;
}

// ── PNG Color Extraction ──
// Zero-dependency PNG decoder for favicon color extraction.
// Parses PNG chunks, decompresses IDAT via DecompressionStream('deflate'),
// un-filters scanlines, and histograms pixel colors to find the dominant brand color.

const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];

/**
 * Async version: decompress PNG IDAT data and extract dominant color.
 * This is the actual implementation used by the pipeline.
 */
async function decompressAndExtract(
  compressed: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | null,
): Promise<string | null> {
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    // Write compressed data and close
    writer.write(compressed as unknown as BufferSource);
    writer.close();

    // Read all decompressed chunks
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLen += value.length;
    }

    // Concatenate
    const raw = new Uint8Array(totalLen);
    let off = 0;
    for (const chunk of chunks) {
      raw.set(chunk, off);
      off += chunk.length;
    }

    return dominantColorFromPixels(raw, width, height, colorType, palette);
  } catch {
    return null;
  }
}

/**
 * Extract dominant color from raw (unfiltered) PNG pixel data.
 * Handles PNG row filters and samples pixels into color buckets.
 */
function dominantColorFromPixels(
  raw: Uint8Array,
  width: number,
  height: number,
  colorType: number,
  palette: Uint8Array | null,
): string | null {
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 1; // bytes per pixel
  const rowBytes = width * bpp;
  const expectedLen = height * (1 + rowBytes); // +1 for filter byte per row

  if (raw.length < expectedLen) return null;

  // Color histogram using 4-bit buckets (16^3 = 4096 buckets)
  const histogram = new Uint32Array(4096);
  const prevRow = new Uint8Array(rowBytes);
  const currRow = new Uint8Array(rowBytes);

  let offset = 0;
  for (let y = 0; y < height; y++) {
    // offset < expectedLen <= raw.length is guaranteed by the length check above.
    const filterType = raw[offset++] ?? 0;

    // Read and un-filter the row
    for (let x = 0; x < rowBytes; x++) {
      // All reads below are in-range because rowBytes slots follow the filter byte on each row.
      const rawByte = raw[offset++] ?? 0;
      const prevAt = prevRow[x] ?? 0;
      const leftAt = x >= bpp ? (currRow[x - bpp] ?? 0) : 0;
      let val = rawByte;

      if (filterType === 1) {
        // Sub: add left neighbor
        val = (rawByte + leftAt) & 0xff;
      } else if (filterType === 2) {
        // Up: add above neighbor
        val = (rawByte + prevAt) & 0xff;
      } else if (filterType === 3) {
        // Average
        val = (rawByte + ((leftAt + prevAt) >> 1)) & 0xff;
      } else if (filterType === 4) {
        // Paeth
        const prevLeft = x >= bpp ? (prevRow[x - bpp] ?? 0) : 0;
        val = (rawByte + paethPredictor(leftAt, prevAt, prevLeft)) & 0xff;
      }

      currRow[x] = val;
    }

    // Sample every 2nd pixel for speed (still 8192 samples on 128x128)
    for (let px = 0; px < width; px += 2) {
      let r: number, g: number, b: number, a: number;

      if (colorType === 3 && palette) {
        // Indexed color
        const idx = (currRow[px] ?? 0) * 3;
        r = palette[idx] ?? 0;
        g = palette[idx + 1] ?? 0;
        b = palette[idx + 2] ?? 0;
        a = 255;
      } else if (colorType === 6) {
        // RGBA
        const base = px * 4;
        r = currRow[base] ?? 0;
        g = currRow[base + 1] ?? 0;
        b = currRow[base + 2] ?? 0;
        a = currRow[base + 3] ?? 0;
      } else {
        // RGB
        const base = px * 3;
        r = currRow[base] ?? 0;
        g = currRow[base + 1] ?? 0;
        b = currRow[base + 2] ?? 0;
        a = 255;
      }

      // Skip transparent, near-white, near-black, and gray pixels
      if (a < 128) continue;
      if (r > 230 && g > 230 && b > 230) continue;
      if (r < 25 && g < 25 && b < 25) continue;
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      if (maxC - minC < 20) continue; // gray

      // Bucket into 4-bit per channel (16 levels)
      const bucket = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      // bucket is in [0, 4095]; histogram has length 4096.
      histogram[bucket] = (histogram[bucket] ?? 0) + 1;
    }

    // Save current row as previous for next iteration
    prevRow.set(currRow);
  }

  // Find the bucket with the most hits
  let maxCount = 0;
  let maxBucket = 0;
  for (let i = 0; i < 4096; i++) {
    const count = histogram[i] ?? 0;
    if (count > maxCount) {
      maxCount = count;
      maxBucket = i;
    }
  }

  if (maxCount === 0) return null;

  // Convert bucket back to RGB (center of the bucket range)
  const rr = ((maxBucket >> 8) & 0xf) * 17;
  const gg = ((maxBucket >> 4) & 0xf) * 17;
  const bb = (maxBucket & 0xf) * 17;

  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ── Async PNG color extraction (for cached data URIs) ──

/**
 * Extract brand color from a PNG data URI asynchronously.
 * Uses DecompressionStream for IDAT decompression.
 */
export async function extractColorFromPNGAsync(data: Uint8Array): Promise<string | null> {
  try {
    for (let i = 0; i < 8; i++) {
      if (data[i] !== PNG_SIG[i]) return null;
    }

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = 0;
    const idatChunks: Uint8Array[] = [];
    let palette: Uint8Array | null = null;

    while (offset < data.length - 4) {
      const chunkLen = view.getUint32(offset);
      // The PNG structure guarantees 4 type bytes follow the length field;
      // bounds were checked via `offset < data.length - 4`.
      const chunkType =
        String.fromCharCode(data[offset + 4] ?? 0) +
        String.fromCharCode(data[offset + 5] ?? 0) +
        String.fromCharCode(data[offset + 6] ?? 0) +
        String.fromCharCode(data[offset + 7] ?? 0);

      if (chunkType === 'IHDR') {
        width = view.getUint32(offset + 8);
        height = view.getUint32(offset + 12);
        bitDepth = data[offset + 16] ?? 0;
        colorType = data[offset + 17] ?? 0;
      } else if (chunkType === 'PLTE') {
        palette = data.slice(offset + 8, offset + 8 + chunkLen);
      } else if (chunkType === 'IDAT') {
        idatChunks.push(data.slice(offset + 8, offset + 8 + chunkLen));
      } else if (chunkType === 'IEND') {
        break;
      }

      offset += 12 + chunkLen;
    }

    if (width === 0 || height === 0 || idatChunks.length === 0) return null;
    if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2 && colorType !== 3)) return null;

    const totalLen = idatChunks.reduce((s, c) => s + c.length, 0);
    const compressed = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of idatChunks) {
      compressed.set(chunk, pos);
      pos += chunk.length;
    }

    return decompressAndExtract(compressed, width, height, colorType, palette);
  } catch {
    return null;
  }
}
