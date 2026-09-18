const crypto = require("crypto");
const path = require("path");

const MOBILE_ATTACHMENT_MAX_HANDLES = 64;

function attachmentError(message, status = 400) {
  const error = new Error(message);
  error.code = "attachment_rejected";
  error.status = status;
  return error;
}

function inputForAttachment(entry) {
  if (entry.type.startsWith("image/")) return { type: "localImage", path: entry.path };
  if (entry.type.startsWith("audio/")) return { type: "localAudio", path: entry.path };
  return { type: "mention", name: entry.name, path: entry.path };
}

/**
 * 將瀏覽器附件轉做短期 opaque handle；前端只會見到同源預覽 URL，唔會收到本機絕對路徑。
 */
function createMobileAttachmentService(options = {}) {
  const pickedFiles = options.pickedFiles;
  const localFiles = options.localFiles;
  const now = options.now || (() => Date.now());
  const randomId = options.randomId || (() => crypto.randomBytes(18).toString("base64url"));
  const handles = new Map();

  if (!pickedFiles?.handlePickFilesPayload || !localFiles?.createLocalFilePreview) {
    throw new TypeError("Mobile attachment dependencies are unavailable");
  }

  function prune() {
    const current = now();
    for (const [id, entry] of handles) {
      if (entry.expiresAtMs <= current) handles.delete(id);
    }
  }

  function upload(files) {
    prune();
    const stored = pickedFiles.handlePickFilesPayload({ files });
    const data = stored.files.map((file) => {
      const preview = localFiles.createLocalFilePreview(file.path);
      const id = `att_${randomId()}`;
      const entry = {
        id,
        path: file.path,
        name: String(file.name || path.basename(file.path)).slice(0, 240),
        type: String(file.type || "application/octet-stream").slice(0, 160),
        size: Number(file.size) || 0,
        expiresAtMs: preview.expiresAtMs,
      };
      handles.set(id, entry);
      while (handles.size > MOBILE_ATTACHMENT_MAX_HANDLES) handles.delete(handles.keys().next().value);
      return {
        id,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        expiresAt: new Date(entry.expiresAtMs).toISOString(),
        // 復用 local-file token，但換成 mobile namespace，避免前端依賴桌面路由。
        previewUrl: preview.url.replace("/api/local-file/", "/api/mobile/files/"),
      };
    });
    return { data };
  }

  function resolve(ids) {
    prune();
    if (!Array.isArray(ids) || ids.length > 20) throw attachmentError("附件列表无效。");
    const seen = new Set();
    return ids.map((value) => {
      const id = String(value || "");
      if (!/^att_[a-zA-Z0-9_-]{12,96}$/.test(id) || seen.has(id)) throw attachmentError("附件凭据无效或重复。");
      seen.add(id);
      const entry = handles.get(id);
      if (!entry) throw attachmentError("附件已过期，请重新上传。", 410);
      return inputForAttachment(entry);
    });
  }

  function dispose() {
    handles.clear();
  }

  return { dispose, resolve, upload, __test: { handleCount: () => handles.size } };
}

module.exports = { MOBILE_ATTACHMENT_MAX_HANDLES, createMobileAttachmentService, inputForAttachment };
