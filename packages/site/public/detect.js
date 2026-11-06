// Platform detection for the download page. `detectPlatform` is pure (tested in
// packages/site/test/detect.test.ts); `detectCurrent` collects the inputs in a browser.

/**
 * @typedef {{ platform?: string, architecture?: string, bitness?: string }} UaHints
 * @typedef {{ userAgent?: string, hints?: UaHints | null, gpu?: string | null }} DetectInput
 * @typedef {{ os: "darwin" | "windows" | "linux" | null, arch: "x64" | "arm64" | null,
 *   platform: string | null, archGuessed: boolean }} Detected
 */

/** @param {DetectInput} input @returns {Detected} */
export function detectPlatform({ userAgent = "", hints = null, gpu = null } = {}) {
  const hp = (hints?.platform ?? "").toLowerCase();
  const ua = userAgent;
  /** @type {Detected["os"]} */
  let os = null;
  if (/iPhone|iPad|iPod|Android/i.test(ua) || hp === "android" || hp === "ios") os = null;
  else if (hp === "macos" || (!hp && /Macintosh|Mac OS X/i.test(ua))) os = "darwin";
  else if (hp === "windows" || (!hp && /Windows|Win32|Win64/i.test(ua))) os = "windows";
  else if (hp === "linux" || hp === "chrome os" || hp === "chromeos" || (!hp && /Linux|X11|CrOS/i.test(ua))) os = "linux";
  if (!os) return { os: null, arch: null, platform: null, archGuessed: false };

  /** @type {Detected["arch"]} */
  let arch = null;
  const ha = (hints?.architecture ?? "").toLowerCase();
  if (ha === "arm") arch = "arm64";
  else if (ha === "x86") arch = hints?.bitness === "32" ? null : "x64";
  // macOS UAs always say "Intel Mac OS X", so the UA only helps on Linux / Windows.
  else if (os !== "darwin" && /aarch64|arm64|armv8/i.test(ua)) arch = "arm64";
  else if (os !== "darwin" && /x86_64|x64|Win64|WOW64|amd64/i.test(ua)) arch = "x64";
  // Safari / Firefox on macOS: the WebGL renderer may name the GPU ("Apple M2" vs "Intel Iris").
  // Safari masks it as "Apple GPU" on every Mac, which tells us nothing.
  else if (os === "darwin" && gpu) {
    if (/Intel|AMD|Radeon|NVIDIA/i.test(gpu)) arch = "x64";
    else if (/Apple M\d/i.test(gpu)) arch = "arm64";
  }

  let archGuessed = false;
  if (!arch) {
    // Like t3.codes: default Macs to Apple Silicon and offer the Intel build next to it.
    arch = os === "darwin" ? "arm64" : "x64";
    archGuessed = true;
  }
  // Windows on ARM runs the x64 build through emulation.
  if (os === "windows") arch = "x64";
  return { os, arch, platform: `${os}-${arch}`, archGuessed };
}

/** Browser glue: high-entropy UA hints when available, WebGL GPU name otherwise. */
export async function detectCurrent() {
  /** @type {UaHints | null} */
  let hints = null;
  const uaData = /** @type {any} */ (navigator).userAgentData;
  if (uaData?.getHighEntropyValues) {
    try {
      hints = await uaData.getHighEntropyValues(["platform", "architecture", "bitness"]);
    } catch {
      hints = { platform: uaData.platform };
    }
  }
  let gpu = null;
  if (!hints?.architecture) {
    try {
      const gl = document.createElement("canvas").getContext("webgl");
      const ext = gl?.getExtension("WEBGL_debug_renderer_info");
      gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
    } catch {}
  }
  return detectPlatform({ userAgent: navigator.userAgent, hints, gpu });
}
