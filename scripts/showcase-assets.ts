import fs from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export async function writeAnimationRuntime(destination: string) {
  const response = await fetch(
    "https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js",
    { signal: AbortSignal.timeout(20000) },
  );
  if (!response.ok)
    throw new Error("Unable to obtain pinned animation runtime");
  if (!response.body) throw new Error("Animation runtime response is empty");
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 256 * 1024)
      throw new Error("Animation runtime exceeds its size limit");
    chunks.push(chunk);
  }
  const runtime = Buffer.concat(chunks);
  if (
    createHash("sha256").update(runtime).digest("hex") !==
    "92bb9a96476f983d212a2bc4f54c889039c1696dd4461d40a736860938570fbb"
  )
    throw new Error("Animation runtime checksum mismatch");
  fs.writeFileSync(destination, runtime);
}

export function encodeWebP(source: string, destination: string) {
  const executable = process.env.CWEBP_EXECUTABLE || Bun.which("cwebp");
  if (!executable)
    throw new Error("Install the WebP cwebp encoder or set CWEBP_EXECUTABLE");
  execFileSync(executable, ["-quiet", "-q", "88", source, "-o", destination]);
}
