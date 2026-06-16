import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getOptionalEnv } from "@/lib/env";

export type StoredObject = {
  key: string;
  absolutePath: string;
  size: number;
};

function resolveStorePath(key: string): string {
  const normalizedKey = path.normalize(key);

  if (normalizedKey.startsWith("..") || path.isAbsolute(normalizedKey)) {
    throw new Error("Storage key must be relative to the file store root.");
  }

  const storeRoot = getOptionalEnv("LOCAL_FILE_STORE_ROOT", "./storage/local");

  return path.resolve(process.cwd(), storeRoot, normalizedKey);
}

export async function putObject(key: string, data: Buffer): Promise<StoredObject> {
  const absolutePath = resolveStorePath(key);

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, data);

  return {
    key,
    absolutePath,
    size: data.byteLength,
  };
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(resolveStorePath(key));
}
