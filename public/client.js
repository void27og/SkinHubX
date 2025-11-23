const lookupForm = document.getElementById("lookup-form");
const lookupResult = document.getElementById("lookup-result");
const uploadForm = document.getElementById("upload-form");
const uploadStatus = document.getElementById("upload-status");
const uploadedSkinsContainer = document.getElementById("uploaded-skins");
const heroViewer = document.getElementById("hero-viewer");
const yearSpan = document.getElementById("year");

let skinviewLoadPromise = null;

if (yearSpan) {
  yearSpan.textContent = new Date().getFullYear();
}

function ensureSkinview3d() {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.skinview3d) return Promise.resolve(window.skinview3d);

  if (!skinviewLoadPromise) {
    const sources = [
      "/skinview3d.bundle.js",
      "https://unpkg.com/skinview3d/bundles/skinview3d.bundle.js",
      "https://cdn.jsdelivr.net/npm/skinview3d/bundles/skinview3d.bundle.js"
    ];

    skinviewLoadPromise = new Promise((resolve, reject) => {
      const tryLoad = (idx = 0) => {
        if (window.skinview3d) {
          resolve(window.skinview3d);
          return;
        }
        const existing = document.querySelector('script[data-skinview="true"]');
        if (existing) {
          existing.addEventListener("load", () => resolve(window.skinview3d));
          existing.addEventListener("error", () => reject(new Error("skinview3d failed to load (existing script)")));
          return;
        }

        if (idx >= sources.length) {
          reject(new Error("All skinview3d sources failed"));
          return;
        }

        const script = document.createElement("script");
        script.src = sources[idx];
        script.async = true;
        script.dataset.skinview = "true";
        script.onload = () => {
          if (window.skinview3d) {
            resolve(window.skinview3d);
          } else {
            tryLoad(idx + 1);
          }
        };
        script.onerror = () => {
          console.error(`skinview3d failed to load from ${sources[idx]}`);
          script.remove();
          tryLoad(idx + 1);
        };
        document.head.appendChild(script);
      };

      tryLoad();
    });
  }

  return skinviewLoadPromise;
}

async function renderSkinViewer(target, skinUrl, options = {}) {
  const container = typeof target === "string" ? document.getElementById(target) : target;
  if (!container) return null;

  container.innerHTML = "";

  const canvas = document.createElement("canvas");
  const width = options.width || container.clientWidth || 200;
  const height = options.height || 230;
  canvas.width = width;
  canvas.height = height;
  container.appendChild(canvas);

  if (options.showHint !== false) {
    const hint = document.createElement("div");
    hint.className = "skin-hint";
    hint.textContent = options.hintText || "Drag to rotate";
    container.appendChild(hint);
  }

  try {
    const skinview3d = await ensureSkinview3d();
    if (!skinview3d) throw new Error("skinview3d missing");

    const viewer = new skinview3d.SkinViewer({
      canvas,
      width,
      height,
      skin: skinUrl
    });

    viewer.autoRotate = options.autoRotate !== false;
    viewer.fov = 70;
    viewer.zoom = options.zoom ?? 0.9;

    // SkinViewer already creates controls; just tune them.
    const controls = viewer.controls;
    controls.enablePan = false;
    controls.enableZoom = options.enableZoom !== false;
    controls.autoRotate = viewer.autoRotate;
    controls.autoRotateSpeed = options.autoRotateSpeed ?? 2;

    return { viewer, controls };
  } catch (err) {
    console.error("Failed to create skin viewer", err);
    container.innerHTML = `<div class="preview-placeholder">Could not load 3D skin.</div>`;
    return null;
  }
}

function setLookupStatus(text) {
  if (lookupResult) {
    lookupResult.textContent = text;
  }
}

function setUploadStatus(text) {
  if (uploadStatus) {
    uploadStatus.textContent = text;
  }
}

function showFallbackImage(container, skinUrl, altText) {
  const img = document.createElement("img");
  img.src = skinUrl;
  img.alt = altText;
  img.className = "skin-fallback";
  container.innerHTML = "";
  container.appendChild(img);
}

// Handle username lookup
if (lookupForm) {
  lookupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const usernameInput = document.getElementById("username");
    const username = usernameInput.value.trim();

    if (!username) return;

    setLookupStatus("Fetching skin from Mojang...");
    try {
      const resp = await fetch(`/api/skin/${encodeURIComponent(username)}`);
      const data = await resp.json();

      if (!resp.ok) {
        setLookupStatus(data.error || "Error fetching skin.");
        return;
      }

      lookupResult.innerHTML = `
        <div class="lookup-meta">
          <div><strong>Username:</strong> ${data.username}</div>
          <div class="skin-meta"><strong>UUID:</strong> <span class="uuid-text">${data.uuid}</span></div>
          <div class="skin-actions">
            <a href="${data.skinUrl}" target="_blank" rel="noopener">Open raw PNG</a>
          </div>
        </div>
        <div id="lookup-viewer" class="skin-viewer"></div>
      `;

      const viewerCreated = await renderSkinViewer("lookup-viewer", data.skinUrl, { height: 280 });
      if (!viewerCreated) {
        const fallbackTarget = document.getElementById("lookup-viewer");
        if (fallbackTarget) {
          showFallbackImage(fallbackTarget, data.skinUrl, `Skin of ${data.username}`);
        }
      }

      if (heroViewer) {
        const heroRender = await renderSkinViewer(heroViewer, data.skinUrl, { height: 240 });
        if (!heroRender) {
          showFallbackImage(heroViewer, data.skinUrl, `Skin of ${data.username}`);
        }
      }
    } catch (err) {
      console.error(err);
      setLookupStatus("Request failed. Check console/logs.");
    }
  });
}

// Handle upload
if (uploadForm) {
  uploadForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const formData = new FormData(uploadForm);
    const file = formData.get("file");

    if (!file || !file.name) {
      setUploadStatus("Please choose a PNG file.");
      return;
    }

    setUploadStatus("Uploading skin...");

    try {
      const resp = await fetch("/api/upload-skin", {
        method: "POST",
        body: formData
      });

      const data = await resp.json();

      if (!resp.ok) {
        setUploadStatus(data.error || "Upload failed.");
        return;
      }

      setUploadStatus("Uploaded successfully.");
      uploadForm.reset();
      await loadUploadedSkins();
    } catch (err) {
      console.error(err);
      setUploadStatus("Upload failed. Check console/logs.");
    }
  });
}

// Load uploaded skins
async function loadUploadedSkins() {
  if (!uploadedSkinsContainer) return;

  uploadedSkinsContainer.textContent = "Loading skins...";

  try {
    const resp = await fetch("/api/uploaded-skins");
    const data = await resp.json();

    if (!Array.isArray(data) || data.length === 0) {
      uploadedSkinsContainer.textContent = "No skins uploaded yet.";
      return;
    }

    const wrapper = document.createElement("div");
    wrapper.className = "skin-grid-inner";

    uploadedSkinsContainer.innerHTML = "";
    uploadedSkinsContainer.appendChild(wrapper);

    for (const skin of data.slice().reverse()) {
      const div = document.createElement("div");
      div.className = "skin-item";

      const uploadedDate = new Date(skin.uploadedAt);
      const niceDate = uploadedDate.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });

      div.innerHTML = `
        <div class="skin-viewer">
          <div class="skin-hint">Drag to rotate</div>
        </div>
        <div class="skin-name">${skin.name || "Untitled skin"}</div>
        <div class="skin-meta">by ${skin.author || "Anonymous"}</div>
        <div class="skin-meta">${niceDate}</div>
        <div class="skin-actions">
          <a href="${skin.url}" download>Download PNG</a>
        </div>
      `;

      wrapper.appendChild(div);

      const viewerContainer = div.querySelector(".skin-viewer");
      const viewerCreated = await renderSkinViewer(viewerContainer, skin.url, { height: 220 });
      if (!viewerCreated) {
        showFallbackImage(viewerContainer, skin.url, skin.name || "Uploaded skin");
      }
    }
  } catch (err) {
    console.error(err);
    uploadedSkinsContainer.textContent = "Failed to load uploaded skins.";
  }
}

// Initial load
loadUploadedSkins();
