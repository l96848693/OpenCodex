const test = require("node:test");
const assert = require("node:assert/strict");
const { createMobileAttachmentService } = require("../runtime/mobile/attachment-service.cjs");

test("mobile attachment upload returns opaque preview and resolves local image input", () => {
  const pickedFiles = { handlePickFilesPayload: ({ files }) => ({ files: files.map((file) => ({ ...file, path: "C:\\workspace\\photo.png", name: file.name, size: file.size })) }) };
  const localFiles = { createLocalFilePreview: () => ({ url: "/api/local-file/tok/photo.png", expiresAtMs: Date.now() + 60_000 }) };
  const service = createMobileAttachmentService({ pickedFiles, localFiles });
  const result = service.upload([{ name: "photo.png", type: "image/png", size: 3, contentsBase64: "YWJj" }]);
  assert.equal(result.data[0].previewUrl, "/api/mobile/files/tok/photo.png");
  assert.deepEqual(service.resolve([result.data[0].id]), [{ type: "localImage", path: "C:\\workspace\\photo.png" }]);
});
