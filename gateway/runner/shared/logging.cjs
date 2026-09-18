/**
 * 啟動器日誌只保留排查所需嘅結構，唔可以將使用者目錄或官方安裝路徑寫出。
 * 呢層集中處理，避免每個 runner 呼叫點漏做脫敏。
 */
function sanitizeLogText(value) {
  const text = String(value ?? "");
  // 盤符／UNC／常見 POSIX 絕對路徑，匹配到下一個 key=value 或行尾。
  return text
    .replace(/(?:\\\\\?\\[A-Za-z]:[\\/]|(?<![A-Za-z0-9])[A-Za-z]:[\\/])[^\r\n"'`]*?(?=\s+[A-Za-z][\w-]*=|\s*$)/g, "[redacted-path]")
    .replace(/(?:^|[\s=])(\\\\[^\\/\s]+[\\/][^\r\n"'`]*?|\/(?:Users|home|tmp|var|private|opt|mnt|media|Volumes|workspace|srv)\/[^\r\n"'`]*?)(?=\s+[A-Za-z][\w-]*=|\s*$)/gm, (match, pathValue) => match.slice(0, match.indexOf(pathValue)) + "[redacted-path]")
    .replace(/([?&](?:token|auth|authorization|code|access_token|refresh_token)=)[^&\s"']+/gi, "$1[redacted]");
}

function sanitizeLogValue(value, key = "") {
  if (typeof value === "string") {
    if (/(?:path|root|asar|executable|runtime|app|source|target|directory|dir|cwd)/i.test(key)) {
      return "[redacted-path]";
    }
    return sanitizeLogText(value);
  }
  if (Array.isArray(value)) return value.map((entry) => sanitizeLogValue(entry, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeLogValue(entryValue, entryKey)]));
  }
  return value;
}

function logLine(logger, message) {
  if (typeof logger === "function") logger(`[launcher] ${sanitizeLogText(message)}\n`);
}

function logJsonLine(logger, message, value) {
  if (typeof logger !== "function") return;
  let json = "";
  try {
    json = JSON.stringify(sanitizeLogValue(value));
  } catch {
    json = sanitizeLogText(value || "");
  }
  logLine(logger, `${message} ${json}`);
}

module.exports = {
  logLine,
  logJsonLine,
  sanitizeLogText,
  sanitizeLogValue,
};
