import { describe, expect, test } from "bun:test";
// biome-ignore lint/suspicious/noTsIgnore: plain JS module shared with the browser, no types
// @ts-ignore
import { detectPlatform } from "../public/detect.js";

const MAC_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const SAFARI_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const WIN_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
const LINUX_ARM_UA = "Mozilla/5.0 (X11; Linux aarch64; rv:132.0) Gecko/20100101 Firefox/132.0";

describe("detect.js", () => {
  test("R-SITE-1: mac arm64 from high-entropy hints (Chrome)", () => {
    expect(detectPlatform({ userAgent: MAC_UA, hints: { platform: "macOS", architecture: "arm", bitness: "64" } }))
      .toEqual({ os: "darwin", arch: "arm64", platform: "darwin-arm64", archGuessed: false });
  });
  test("R-SITE-1: mac intel from hints or GPU name", () => {
    expect(detectPlatform({ userAgent: MAC_UA, hints: { platform: "macOS", architecture: "x86", bitness: "64" } }).platform).toBe("darwin-x64");
    expect(detectPlatform({ userAgent: SAFARI_UA, gpu: "Intel(R) Iris(TM) Plus Graphics 655" }).platform).toBe("darwin-x64");
    expect(detectPlatform({ userAgent: SAFARI_UA, gpu: "Apple M3 Pro" })).toMatchObject({ platform: "darwin-arm64", archGuessed: false });
  });
  test("R-SITE-1: Safari without a usable hint defaults to Apple Silicon, flagged as a guess", () => {
    expect(detectPlatform({ userAgent: SAFARI_UA, gpu: "Apple GPU" })).toEqual({ os: "darwin", arch: "arm64", platform: "darwin-arm64", archGuessed: true });
  });
  test("R-SITE-1: windows x64 (also for Windows on ARM)", () => {
    expect(detectPlatform({ userAgent: WIN_UA }).platform).toBe("windows-x64");
    expect(detectPlatform({ userAgent: WIN_UA, hints: { platform: "Windows", architecture: "arm", bitness: "64" } }).platform).toBe("windows-x64");
  });
  test("R-SITE-1: linux x64 and arm64", () => {
    expect(detectPlatform({ userAgent: LINUX_UA })).toMatchObject({ platform: "linux-x64", archGuessed: false });
    expect(detectPlatform({ userAgent: LINUX_ARM_UA }).platform).toBe("linux-arm64");
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (X11; Linux)", hints: { platform: "Linux", architecture: "arm", bitness: "64" } }).platform).toBe("linux-arm64");
  });
  test("R-SITE-1: unknown and mobile platforms", () => {
    expect(detectPlatform({ userAgent: "curl/8.5.0" }).platform).toBeNull();
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" }).os).toBeNull();
    expect(detectPlatform({ userAgent: "Mozilla/5.0 (Linux; Android 15; Pixel 9)", hints: { platform: "Android" } }).os).toBeNull();
    expect(detectPlatform().platform).toBeNull();
  });
});
