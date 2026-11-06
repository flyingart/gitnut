import { describe, expect, test } from "bun:test";
import {
  DESKTOP_ASSETS,
  PLATFORMS,
  assetFile,
  assetUrl,
  buildManifest,
  formatSha256Sums,
  parseSha256Sums,
} from "../src";

describe("assets", () => {
  test("R-UPD-1: assetUrl joins base, version and file", () => {
    expect(assetUrl("https://dl.example.com/gitnut/", "1.2.3", "gitnut-linux-x64")).toBe(
      "https://dl.example.com/gitnut/1.2.3/gitnut-linux-x64",
    );
  });

  test("R-UPD-1: buildManifest keys CLI binaries by platform and installers by desktop-<platform>", () => {
    const m = buildManifest({
      version: "1.2.3",
      base: "https://dl.example.com",
      notes: "Fixes",
      publishedAt: "2026-11-06T00:00:00Z",
      downloadPage: "https://gitnut.example.com",
      sha256s: { "gitnut-linux-x64": "a".repeat(64) },
    });
    expect(m.version).toBe("1.2.3");
    expect(m.notes).toBe("Fixes");
    expect(m.downloadPage).toBe("https://gitnut.example.com");
    for (const p of PLATFORMS) expect(m.assets[p].url).toStartWith("https://dl.example.com/1.2.3/gitnut-");
    expect(m.assets["windows-x64"].url).toEndWith("/gitnut-windows-x64.exe");
    expect(m.assets["linux-x64"].sha256).toBe("a".repeat(64));
    expect(m.assets["linux-arm64"].sha256).toBeUndefined();
    expect(m.assets["desktop-darwin-arm64"].url).toBe("https://dl.example.com/1.2.3/GitNut-1.2.3-darwin-arm64.dmg");
    expect(m.assets["desktop-windows-x64"].url).toEndWith("-setup.exe");
    expect(m.assets["desktop-linux-x64"].url).toEndWith(".AppImage");
    expect(m.assets["desktop-linux-x64-deb"].url).toEndWith(".deb");
    expect(Object.keys(m.assets)).toHaveLength(PLATFORMS.length + DESKTOP_ASSETS.length);
  });

  test("R-UPD-1: assetFile resolves keys, unknown keys give null", () => {
    expect(assetFile("darwin-arm64", "1.0.0")).toBe("gitnut-darwin-arm64");
    expect(assetFile("desktop-darwin-x64", "1.0.0")).toBe("GitNut-1.0.0-darwin-x64.dmg");
    expect(assetFile("nope", "1.0.0")).toBeNull();
  });

  test("R-UPD-2: SHA256SUMS round-trips (text and binary mode lines)", () => {
    const sums = { "gitnut-linux-x64": "b".repeat(64), "GitNut-1.0.0-linux-x64.deb": "c".repeat(64) };
    expect(parseSha256Sums(formatSha256Sums(sums))).toEqual(sums);
    expect(parseSha256Sums(`${"D".repeat(64)} *gitnut.exe\r\njunk\n`)).toEqual({ "gitnut.exe": "d".repeat(64) });
  });
});
