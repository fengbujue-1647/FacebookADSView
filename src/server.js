const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 3100);
const host = process.env.HOST || "127.0.0.1";
const publicDir = path.resolve(__dirname, "..", "public");
const repoRoot = path.resolve(__dirname, "..");
const cliOutputDir = path.join(repoRoot, "cli", "data", "output");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
};

function writeJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendFile(res, filePath) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      writeJson(res, 404, { ok: false, error: "not_found" });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function resolvePublicPath(pathname) {
  const cleanPath = pathname === "/" ? "/index.html" : decodeURIComponent(pathname);
  const resolved = path.resolve(publicDir, `.${cleanPath}`);
  const insidePublic = resolved === publicDir || resolved.startsWith(`${publicDir}${path.sep}`);
  return insidePublic ? resolved : null;
}

function latestAdsDataFile() {
  if (!fs.existsSync(cliOutputDir)) return null;
  const files = fs.readdirSync(cliOutputDir)
    .filter((file) => /^facebook_ads_.*\.json$/.test(file))
    .map((file) => {
      const filePath = path.join(cliOutputDir, file);
      return {
        file,
        filePath,
        mtimeMs: fs.statSync(filePath).mtimeMs
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  return files[0] || null;
}

function sendLatestAdsData(res) {
  const latest = latestAdsDataFile();
  if (!latest) {
    writeJson(res, 404, { ok: false, error: "no_collected_data" });
    return;
  }

  try {
    const text = fs.readFileSync(latest.filePath, "utf8").replace(/^\uFEFF/, "");
    const rows = JSON.parse(text);
    writeJson(res, 200, {
      ok: true,
      source: latest.file,
      updated_at: new Date(latest.mtimeMs).toISOString(),
      rows
    });
  } catch (readError) {
    writeJson(res, 500, {
      ok: false,
      error: "read_failed",
      message: readError.message
    });
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/health") {
    writeJson(res, 200, {
      ok: true,
      module: "fb-ads-dashboard",
      time: new Date().toISOString()
    });
    return;
  }

  if (url.pathname === "/api/fb-ads/latest") {
    sendLatestAdsData(res);
    return;
  }

  if (url.pathname === "/meta-relationship-map.html") {
    sendFile(res, path.join(repoRoot, "meta-relationship-map.html"));
    return;
  }

  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) {
    writeJson(res, 403, { ok: false, error: "forbidden" });
    return;
  }

  sendFile(res, filePath);
});

server.listen(port, host, () => {
  console.log(`FB Ads Dashboard running at http://${host}:${port}/`);
  console.log(`Health check: http://${host}:${port}/api/health`);
});
