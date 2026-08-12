import type { PlatformRecord, PlatformRepository } from "./types";

/** Shared adapter contract used by durable Blob fixtures and isolated Postgres. */
export async function exercisePlatformRepository(repository: PlatformRepository, records: PlatformRecord[]) {
  for (const record of records) await repository.put(record);
  const identifiers = new Set(records.map((record) => `${record.family}:${record.key}`));
  const portable = (record: PlatformRecord) => {
    const { sourceChecksum: _sourceChecksum, ...value } = record;
    return value;
  };
  const expected = [...records].map(portable).sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));
  const listed = (await repository.list()).filter((record) => identifiers.has(`${record.family}:${record.key}`)).map(portable).sort((left, right) => `${left.family}:${left.key}`.localeCompare(`${right.family}:${right.key}`));
  const loaded = (await Promise.all(records.map((record) => repository.get(record.family, record.key)))).map((record) => record ? portable(record) : null).sort((left, right) => `${left?.family}:${left?.key}`.localeCompare(`${right?.family}:${right?.key}`));
  return { listed, expected, loaded };
}
