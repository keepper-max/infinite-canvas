import assert from "node:assert/strict";
import test from "node:test";

import { resolveLegacyAssetVersionMatches } from "../src/repository.js";

const FIRST_SHA256 = "a".repeat(64);
const SECOND_SHA256 = "b".repeat(64);

function version(
  id: string,
  localStorageKey: string,
  sha256: string,
) {
  return {
    id,
    assetId: `asset-${id}`,
    storageKey: `projects/project/image/${id}`,
    localStorageKey,
    sha256,
  };
}

test("legacy asset binding accepts one matching version", () => {
  const candidate = version("one", "image:legacy", "same-content");
  const matches = resolveLegacyAssetVersionMatches([candidate]);

  assert.deepEqual(matches.get("image:legacy"), candidate);
});

test("legacy asset binding accepts duplicate versions with identical content", () => {
  const first = version("one", "image:legacy", FIRST_SHA256);
  const duplicate = version("two", "image:legacy", FIRST_SHA256);
  const matches = resolveLegacyAssetVersionMatches([first, duplicate]);

  assert.deepEqual(matches.get("image:legacy"), first);
});

test("legacy asset binding rejects versions with different content", () => {
  const matches = resolveLegacyAssetVersionMatches([
    version("one", "image:legacy", FIRST_SHA256),
    version("two", "image:legacy", SECOND_SHA256),
    version("three", "image:legacy", FIRST_SHA256),
  ]);

  assert.equal(matches.get("image:legacy"), null);
});

test("legacy asset binding rejects duplicate versions with placeholder hashes", () => {
  const placeholder = "0".repeat(64);
  const matches = resolveLegacyAssetVersionMatches([
    version("one", "image:legacy", placeholder),
    version("two", "image:legacy", placeholder),
  ]);

  assert.equal(matches.get("image:legacy"), null);
});
