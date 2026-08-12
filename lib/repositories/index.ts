import { BlobRepository } from "./blob-repository";
import { DualRepository } from "./dual-repository";
import { PostgresRepository } from "./postgres-repository";
import type { PlatformRepository, RepositoryBackend } from "./types";
import { hasCurrentTrustedVerificationArtifact } from "./trusted-verification";

export { BlobRepository } from "./blob-repository";
export { DualRepository } from "./dual-repository";
export { PostgresRepository } from "./postgres-repository";
export * from "./types";

export async function getRepository(backend: RepositoryBackend = "blob"): Promise<PlatformRepository> {
  if (backend === "blob") return new BlobRepository();
  const postgres = new PostgresRepository();
  if (backend === "dual") return new DualRepository(new BlobRepository(), postgres);
  if (!(await hasCurrentTrustedVerificationArtifact())) throw new Error("Cannot select postgres without a trusted persisted verification artifact");
  return postgres;
}
