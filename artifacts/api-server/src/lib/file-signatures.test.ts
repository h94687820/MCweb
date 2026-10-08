import assert from "node:assert/strict";
import test from "node:test";
import { hasSupportedImageSignature, hasZipContainerSignature } from "./file-signatures";

test("accepts standard ZIP, empty ZIP, and spanning ZIP headers", () => {
  for (const signature of [
    [0x50, 0x4b, 0x03, 0x04],
    [0x50, 0x4b, 0x05, 0x06],
    [0x50, 0x4b, 0x07, 0x08],
  ]) {
    assert.equal(hasZipContainerSignature(new Uint8Array(signature)), true);
  }
  assert.equal(hasZipContainerSignature(new Uint8Array([0, 0, 0, 0])), false);
  assert.equal(hasZipContainerSignature(new Uint8Array([0x50, 0x4b, 0x03])), false);
});

test("matches supported image extensions to their content signatures", () => {
  assert.equal(hasSupportedImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0]), ".jpg"), true);
  assert.equal(
    hasSupportedImageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ".png"),
    true,
  );
  assert.equal(
    hasSupportedImageSignature(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), ".gif"),
    true,
  );
  assert.equal(
    hasSupportedImageSignature(
      new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ".webp",
    ),
    true,
  );
  assert.equal(hasSupportedImageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), ".png"), false);
  assert.equal(hasSupportedImageSignature(new Uint8Array([0xff, 0xd8, 0xff]), ".png"), false);
});
