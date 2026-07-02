export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

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
    background: #0f1117;
    color: #e6e6e6;
    padding: 24px;
  }
  h1 { font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #999; margin-top: 0; margin-bottom: 20px; font-size: 14px; }
  .dropzone {
    border: 2px dashed #444;
    border-radius: 12px;
    padding: 40px 20px;
    text-align: center;
    cursor: pointer;
    transition: 0.2s;
    background: #171a23;
  }
  .dropzone.drag { border-color: #6c9eff; background: #1b2030; }
  .dropzone p { margin: 0; color: #aaa; }
  input[type="file"] { display: none; }
  #fileList {
    margin-top: 24px;
    display: grid;
    gap: 10px;
  }
  .file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #171a23;
    border: 1px solid #262a36;
    border-radius: 10px;
    padding: 12px 16px;
  }
  .file-info { display: flex; align-items: center; gap: 12px; overflow: hidden; }
  .file-icon { font-size: 22px; }
  .file-name { font-size: 14px; word-break: break-all; }
  .file-meta { font-size: 12px; color: #888; }
  .actions { display: flex; gap: 8px; flex-shrink: 0; }
  button {
    background: #262a36;
    color: #e6e6e6;
    border: none;
    padding: 6px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 13px;
  }
  button:hover { background: #333849; }
  button.danger:hover { background: #5c2a2a; }
  #progress { font-size: 13px; color: #6c9eff; margin-top: 10px; min-height: 18px; }
  #empty { color: #666; text-align: center; padding: 30px; font-size: 14px; }
</style>
</head>
<body>
  <h1>📦 My File Storage</h1>
  <p class="sub">Cloudflare R2 ပေါ်တွင် ပုံ၊ Text၊ Python၊ HTML နှင့် code files များ သိမ်းဆည်းနိုင်ပါသည်</p>

  <div class="dropzone" id="dropzone">
    <p>ဖိုင်များကို ဒီနေရာသို့ ဆွဲထည့်ပါ (သို့) နှိပ်ပြီး ရွေးချယ်ပါ</p>
    <input type="file" id="fileInput" multiple />
  </div>
  <div id="progress"></div>

  <div id="fileList"></div>
  <div id="empty" style="display:none;">ဖိုင်များ မရှိသေးပါ</div>

<script>
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const fileList = document.getElementById('fileList');
  const progress = document.getElementById('progress');
  const empty = document.getElementById('empty');

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    uploadFiles(e.dataTransfer.files);
  });
  fileInput.addEventListener('change', () => uploadFiles(fileInput.files));

  async function uploadFiles(files) {
    for (const file of files) {
      progress.textContent = 'Uploading: ' + file.name + ' ...';
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
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
      png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
      pdf: '📕', zip: '🗜️', rar: '🗜️',
    };
    return map[ext] || '📁';
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  async function loadFiles() {
    const res = await fetch('/api/files');
    const files = await res.json();
    fileList.innerHTML = '';
    empty.style.display = files.length === 0 ? 'block' : 'none';
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML = \`
        <div class="file-info">
          <span class="file-icon">\${iconFor(f.key)}</span>
          <div>
            <div class="file-name">\${f.key}</div>
            <div class="file-meta">\${formatSize(f.size)} • \${new Date(f.uploaded).toLocaleString()}</div>
          </div>
        </div>
        <div class="actions">
          <button onclick="window.open('/api/download/\${encodeURIComponent(f.key)}', '_blank')">ဖွင့်ကြည့်</button>
          <button class="danger" onclick="deleteFile('\${f.key.replace(/'/g, "\\\\'")}')">ဖျက်</button>
        </div>
      \`;
      fileList.appendChild(row);
    }
  }

  async function deleteFile(key) {
    if (!confirm('ဖျက်မှာသေချာလား? — ' + key)) return;
    await fetch('/api/files/' + encodeURIComponent(key), { method: 'DELETE' });
    loadFiles();
  }

  loadFiles();
</script>
</body>
</html>`;
