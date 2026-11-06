import { rmSync } from "node:fs";

export default function teardown() {
  if (process.env.GITNUT_E2E_DIR) rmSync(process.env.GITNUT_E2E_DIR, { recursive: true, force: true });
}
