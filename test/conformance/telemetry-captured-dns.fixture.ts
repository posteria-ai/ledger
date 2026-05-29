import { resolve } from "node:dns/promises";

export async function resolveWithCapturedNamedImport(): Promise<void> {
  await resolve("example.invalid");
}
