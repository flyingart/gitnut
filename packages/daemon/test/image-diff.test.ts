import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readSide } from "../src/files";
import { g, tmp } from "./helpers";

// 1×1 transparent PNG
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("R-DIFF-6: images come back as base64 for the image diff; other binaries stay a placeholder", async () => {
  const repo = join(tmp(), "img");
  mkdirSync(repo);
  g(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "logo.png"), PNG);
  writeFileSync(join(repo, "blob.bin"), Buffer.from([0, 1, 2, 0]));
  g(repo, "add", "-A");
  g(repo, "commit", "-q", "-m", "assets");
  const head = g(repo, "rev-parse", "HEAD");

  const committed = await readSide(repo, { ref: head, path: "logo.png" }, true);
  expect(committed).toMatchObject({ binary: true, size: PNG.length, image: { mime: "image/png", base64: PNG.toString("base64") } });
  const worktree = await readSide(repo, { ref: "WORKTREE", path: "logo.png" }, true);
  expect(worktree?.image?.base64).toBe(PNG.toString("base64"));
  const other = await readSide(repo, { ref: head, path: "blob.bin" }, true);
  expect(other).toEqual({ binary: true, size: 4 });
});
