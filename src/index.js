// ---------- Helpers: session token signing (HMAC-SHA256) ----------
async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSessionToken(secret) {
  const expiry = Date.now() + 30 * 24 * 60 * 60 * 1000; // 30 days
  const sig = await hmacSha256Hex(secret, String(expiry));
  return `${expiry}.${sig}`;
}

async function verifySessionToken(token, secret) {
  if (!token) return false;
  const [expiry, sig] = token.split(".");
  if (!expiry || !sig) return false;
  if (Date.now() > Number(expiry)) return false;
  const expected = await hmacSha256Hex(secret, expiry);
  return expected === sig;
}

function getCookie(request, name) {
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

// ---------- Main Worker ----------
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const PASSWORD = env.PASSWORD;

    if (!PASSWORD) {
      return new Response(
        "⚠️ PASSWORD secret မထည့်ရသေးပါ။ Worker Settings → Variables and secrets ထဲမှာ PASSWORD ဆိုတဲ့ secret ထည့်ပါ။",
        { status: 500 }
      );
    }

    // ---------- Login page ----------
    if (path === "/login" && request.method === "GET") {
      return new Response(LOGIN_HTML(""), {
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }

    if (path === "/login" && request.method === "POST") {
      const formData = await request.formData();
      const password = formData.get("password");
      if (password === PASSWORD) {
        const token = await createSessionToken(PASSWORD);
        const headers = new Headers();
        headers.set(
          "Set-Cookie",
          `session=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`
        );
        headers.set("Location", "/");
        return new Response(null, { status: 302, headers });
      }
      return new Response(LOGIN_HTML("Password မှားနေပါသည်"), {
        status: 401,
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }

    // ---------- Logout ----------
    if (path === "/logout") {
      const headers = new Headers();
      headers.set(
        "Set-Cookie",
        `session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
      );
      headers.set("Location", "/login");
      return new Response(null, { status: 302, headers });
    }

    // ---------- Auth gate for everything else ----------
    const token = getCookie(request, "session");
    const authed = await verifySessionToken(token, PASSWORD);
    if (!authed) {
      if (path.startsWith("/api/")) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return Response.redirect(url.origin + "/login", 302);
    }

    // ---------- Frontend ----------
    if (path === "/" && request.method === "GET") {
      return new Response(HTML, {
        headers: { "content-type": "text/html;charset=UTF-8" },
      });
    }

    // ---------- List all files ----------
    if (path === "/api/files" && request.method === "GET") {
      const list = await env.FILES.list();
      const files = list.objects
        .map((obj) => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
        }))
        .sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));
      return Response.json(files);
    }

    // ---------- Upload a file ----------
    if (path === "/api/upload" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const file = formData.get("file");
        if (!file || typeof file === "string") {
          return Response.json({ error: "File not found" }, { status: 400 });
        }
        const key = file.name;
        await env.FILES.put(key, await file.arrayBuffer(), {
          httpMetadata: {
            contentType: file.type || "application/octet-stream",
          },
        });
        return Response.json({ success: true, key });
      } catch (err) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // ---------- Download / view a file ----------
    if (path.startsWith("/api/download/") && request.method === "GET") {
      const key = decodeURIComponent(path.replace("/api/download/", ""));
      const obj = await env.FILES.get(key);
      if (!obj) return new Response("Not found", { status: 404 });
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set("etag", obj.httpEtag);
      return new Response(obj.body, { headers });
    }

    // ---------- Delete a file ----------
    if (path.startsWith("/api/files/") && request.method === "DELETE") {
      const key = decodeURIComponent(path.replace("/api/files/", ""));
      await env.FILES.delete(key);
      return Response.json({ success: true });
    }

    return new Response("Not found", { status: 404 });
  },
};

// ---------- Login page HTML ----------
const LOGIN_HTML = (error) => `<!DOCTYPE html>
<html lang="my">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Login — My File Storage</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(circle at 20% 20%, #1e2540 0%, #0b0d17 55%, #05060a 100%);
    color: #eaeaf5;
    padding: 24px;
  }
  .card {
    width: 100%;
    max-width: 360px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    backdrop-filter: blur(12px);
    border-radius: 20px;
    padding: 36px 28px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
  .logo { font-size: 42px; text-align: center; margin-bottom: 8px; }
  h1 { font-size: 19px; text-align: center; margin: 0 0 24px; font-weight: 600; color: #fff; }
  label { font-size: 13px; color: #9a9ab5; display: block; margin-bottom: 8px; }
  input[type="password"] {
    width: 100%;
    padding: 13px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.12);
    background: rgba(0,0,0,0.3);
    color: #fff;
    font-size: 15px;
    outline: none;
    transition: border-color 0.2s;
  }
  input[type="password"]:focus { border-color: #7c93ff; }
  button {
    width: 100%;
    margin-top: 18px;
    padding: 13px;
    border: none;
    border-radius: 12px;
    background: linear-gradient(135deg, #7c93ff, #5f6fff);
    color: white;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
    transition: transform 0.15s, opacity 0.15s;
  }
  button:active { transform: scale(0.98); opacity: 0.9; }
  .error {
    color: #ff8a9a;
    font-size: 13px;
    text-align: center;
    margin: -8px 0 16px;
  }
</style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <div class="logo">📦</div>
    <h1>My File Storage</h1>
    ${error ? `<p class="error">${error}</p>` : ""}
    <label for="password">Password</label>
    <input type="password" id="password" name="password" autofocus required />
    <button type="submit">ဝင်ရောက်မည်</button>
  </form>
</body>
</html>`;

// ---------- Main app HTML ----------
const HTML = `<!DOCTYPE html>
<html lang="my">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>My File Storage</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: radial-gradient(circle at 15% 0%, #1b2140 0%, #0b0d17 45%, #05060a 100%);
    color: #eaeaf5;
    padding: 20px;
    min-height: 100vh;
  }
  .topbar {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    max-width: 720px;
    margin: 0 auto 20px;
  }
  h1 { font-size: 21px; margin: 0 0 4px; font-weight: 700; letter-spacing: -0.3px; }
  p.sub { color: #8f8fae; margin: 0; font-size: 13.5px; }
  a.logout {
    font-size: 13px;
    color: #9aa4ff;
    text-decoration: none;
    border: 1px solid rgba(255,255,255,0.12);
    padding: 7px 14px;
    border-radius: 100px;
    white-space: nowrap;
    margin-top: 2px;
  }
  .container { max-width: 720px; margin: 0 auto; }
  .stats {
    display: flex;
    gap: 10px;
    margin-bottom: 18px;
  }
  .stat {
    flex: 1;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 14px;
    padding: 12px 14px;
  }
  .stat .num { font-size: 18px; font-weight: 700; color: #fff; }
  .stat .label { font-size: 11.5px; color: #8f8fae; margin-top: 2px; }
  .dropzone {
    border: 1.5px dashed rgba(124,147,255,0.4);
    border-radius: 18px;
    padding: 34px 20px;
    text-align: center;
    cursor: pointer;
    transition: 0.2s;
    background: rgba(124,147,255,0.05);
  }
  .dropzone.drag { border-color: #7c93ff; background: rgba(124,147,255,0.12); }
  .dropzone .icon { font-size: 28px; margin-bottom: 6px; }
  .dropzone p { margin: 0; color: #b3b3cc; font-size: 14px; }
  input[type="file"] { display: none; }
  #progress { font-size: 13px; color: #9aa4ff; margin-top: 10px; min-height: 18px; }
  .search {
    margin-top: 22px;
    margin-bottom: 12px;
  }
  .search input {
    width: 100%;
    padding: 11px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.1);
    background: rgba(255,255,255,0.03);
    color: #fff;
    font-size: 14px;
    outline: none;
  }
  .search input::placeholder { color: #7a7a95; }
  #fileList { display: grid; gap: 10px; }
  .file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: rgba(255,255,255,0.035);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    padding: 12px 14px;
    transition: background 0.15s, border-color 0.15s;
  }
  .file-row:hover { background: rgba(255,255,255,0.06); border-color: rgba(255,255,255,0.14); }
  .file-info { display: flex; align-items: center; gap: 12px; overflow: hidden; }
  .file-icon {
    font-size: 20px;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255,255,255,0.06);
    border-radius: 10px;
    flex-shrink: 0;
    overflow: hidden;
  }
  .file-icon img { width: 100%; height: 100%; object-fit: cover; }
  .file-name { font-size: 14px; word-break: break-all; color: #f0f0f7; }
  .file-meta { font-size: 11.5px; color: #7a7a95; margin-top: 2px; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  button.act {
    background: rgba(255,255,255,0.07);
    color: #eaeaf5;
    border: none;
    padding: 7px 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 12.5px;
    transition: background 0.15s;
  }
  button.act:hover { background: rgba(255,255,255,0.14); }
  button.act.danger:hover { background: rgba(255,80,80,0.25); color: #ff9999; }
  #empty { color: #666; text-align: center; padding: 40px 20px; font-size: 14px; }
</style>
</head>
<body>
  <div class="container">
    <div class="topbar">
      <div>
        <h1>📦 My File Storage</h1>
        <p class="sub">Cloudflare R2 ပေါ်တွင် ဖိုင်များ သိမ်းဆည်းနိုင်ပါသည်</p>
      </div>
      <a class="logout" href="/logout">ထွက်မည်</a>
    </div>

    <div class="stats">
      <div class="stat"><div class="num" id="statCount">–</div><div class="label">ဖိုင်စုစုပေါင်း</div></div>
      <div class="stat"><div class="num" id="statSize">–</div><div class="label">Storage သုံးထားမှု</div></div>
    </div>

    <div class="dropzone" id="dropzone">
      <div class="icon">☁️</div>
      <p>ဖိုင်များကို ဒီနေရာသို့ ဆွဲထည့်ပါ (သို့) နှိပ်ပြီး ရွေးချယ်ပါ</p>
      <input type="file" id="fileInput" multiple />
    </div>
    <div id="progress"></div>

    <div class="search">
      <input type="text" id="searchBox" placeholder="ဖိုင်အမည်ဖြင့် ရှာဖွေပါ..." />
    </div>

    <div id="fileList"></div>
    <div id="empty" style="display:none;">ဖိုင်များ မရှိသေးပါ</div>
  </div>

<script>
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const progress = document.getElementById('progress');
  const empty = document.getElementById('empty');
  const searchBox = document.getElementById('searchBox');
  const statCount = document.getElementById('statCount');
  const statSize = document.getElementById('statSize');

  let allFiles = [];

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    uploadFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files));
  searchBox.addEventListener('input', () => renderFiles());

  async function uploadFiles(files) {
    for (const file of files) {
      progress.textContent = 'Uploading: ' + file.name + ' ...';
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        if (res.status === 401) { window.location.href = '/login'; return; }
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Upload failed');
      } catch (err) {
        alert('Upload error: ' + err.message);
      }
    }
    progress.textContent = '';
    loadFiles();
  }

  function iconFor(name) {
    const ext = name.split('.').pop().toLowerCase();
    const map = {
      py: '🐍', js: '📜', html: '🌐', htm: '🌐', css: '🎨',
      txt: '📄', md: '📝', json: '🧾', csv: '📊',
      pdf: '📕', zip: '🗜️', rar: '🗜️', mp4: '🎬', mp3: '🎵',
    };
    return map[ext] || '📁';
  }

  function isImage(name) {
    return /\\.(png|jpe?g|gif|webp|svg)$/i.test(name);
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  async function loadFiles() {
    const res = await fetch('/api/files');
    if (res.status === 401) { window.location.href = '/login'; return; }
    allFiles = await res.json();
    statCount.textContent = allFiles.length;
    const totalSize = allFiles.reduce((sum, f) => sum + f.size, 0);
    statSize.textContent = formatSize(totalSize);
    renderFiles();
  }

  function renderFiles() {
    const q = searchBox.value.trim().toLowerCase();
    const files = allFiles.filter((f) => f.key.toLowerCase().includes(q));
    fileList.innerHTML = '';
    empty.style.display = files.length === 0 ? 'block' : 'none';
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'file-row';
      const iconHtml = isImage(f.key)
        ? \`<img src="/api/download/\${encodeURIComponent(f.key)}" alt="" />\`
        : iconFor(f.key);
      row.innerHTML = \`
        <div class="file-info">
          <span class="file-icon">\${iconHtml}</span>
          <div>
            <div class="file-name">\${f.key}</div>
            <div class="file-meta">\${formatSize(f.size)} • \${new Date(f.uploaded).toLocaleString()}</div>
          </div>
        </div>
        <div class="actions">
          <button class="act" onclick="window.open('/api/download/\${encodeURIComponent(f.key)}', '_blank')">ဖွင့်ကြည့်</button>
          <button class="act danger" onclick="deleteFile('\${f.key.replace(/'/g, "\\\\'")}')">ဖျက်</button>
        </div>
      \`;
      fileList.appendChild(row);
    }
  }

  async function deleteFile(key) {
    if (!confirm('ဖျက်မှာသေချာလား? — ' + key)) return;
    const res = await fetch('/api/files/' + encodeURIComponent(key), { method: 'DELETE' });
    if (res.status === 401) { window.location.href = '/login'; return; }
    loadFiles();
  }

  loadFiles();
</script>
</body>
</html>`;
