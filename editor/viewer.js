/**
 * File: viewer.js
 * Purpose: This is the logic for the Source Code Viewer.
 * Why it's needed: It unzips the extension, builds the folder tree, and shows the code/images on screen.
 * If not used: You can download the extension as a ZIP, but you won't be able to "View Source" online.
 */

// Get extension ID and Edge store flags passed from background script
const urlParams = new URLSearchParams(window.location.search);
const targetId = urlParams.get("id");
const edgeFlag = urlParams.get("edge") === "1";

// DOM elements
const uiProg = document.getElementById("prog");
const uiLogs = document.getElementById("logs");
const uiLoad = document.getElementById("loading");
const uiSidebar = document.getElementById("sidebar");
const uiCode = document.getElementById("codebox");
const uiTitle = document.getElementById("titlebar-txt");

// Update status log
const log = (msg) => {
  uiLogs.innerText = `> ${msg}`;
};

// Simple HTML escaper to prevent XSS when showing code
const escapeHtml = (unsafe) => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

// Create Chrome/Edge download URL parameters based on user's browser
const synthesizeParams = () => {
  let navUA = navigator.userAgent || "";
  let systemArch = navUA.includes("x64") ? "x86-64" : "arm";
  let verQuery = /(?:Chrome|Edge)\/([\d\.]+)/.exec(navUA);
  let vFallback = verQuery ? verQuery[1] : "105.0.0.0";
  return `prodversion=${vFallback}&nacl_arch=${systemArch}&acceptformat=crx2,crx3`;
};

// Main entry point
const init = async () => {
  // Make sure we have an ID
  if (!targetId) return log("FATAL: Missing extension ID bounds.");

  // Chrome Web Store download URL
  let computedUrl =
    `https://clients2.google.com/service/update2/crx?response=redirect&x=id%3D${targetId}%26installsource%3Dondemand%26uc&` +
    synthesizeParams();

  // Microsoft Edge Addons download URL
  if (edgeFlag) {
    computedUrl = `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${targetId}%26installsource%3Dondemand%26uc`;
  }

  try {
    log("Hacking target stream...");

    // Download extension as a stream so we can show a progress bar
    let remoteCall = await fetch(computedUrl, { redirect: "follow" });
    let totalSize = remoteCall.headers.get("content-length");
    let total = totalSize ? parseInt(totalSize, 10) : 0;

    let reader = remoteCall.body.getReader();
    let chunks = [];
    let received = 0;

    // Read byte chunks and update GUI progress bar
    while (true) {
      let { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      let pct = total
        ? (received / total) * 100
        : Math.min((received / 5000000) * 100, 95);
      uiProg.style.width = `${pct}%`;
      log(`Receiving bytes [${Math.floor(pct)}%]`);
    }

    log("Slicing proprietary CRX headers securely...");

    // Combine chunks into a single binary array
    let binMap = new Uint8Array(received);
    let offset = 0;
    for (let c of chunks) {
      binMap.set(c, offset);
      offset += c.length;
    }

    // Parse CRX headers (CRX files have a custom header before the zip data starts)
    if (binMap.length < 16) throw new Error("Downloaded file is too small to be a valid CRX.");
    let structView = new DataView(binMap.buffer);
    let versionFlag = structView.getUint32(4, true);
    let startDex = 0;

    // DO NOT CHANGE these offsets! Modifying this will corrupt the ZIP and crash the viewer.
    if (versionFlag === 2) {
      if (binMap.length < 16) throw new Error("Invalid CRX v2 header size.");
      startDex =
        16 + structView.getUint32(8, true) + structView.getUint32(12, true);
    } else if (versionFlag === 3) {
      if (binMap.length < 12) throw new Error("Invalid CRX v3 header size.");
      startDex = 12 + structView.getUint32(8, true);
    } else {
      throw new Error("Invalid or Unsupported CRX Header version.");
    }

    if (startDex >= binMap.length) throw new Error("Header offset exceeds file size (corrupted download).");
    let zipChunk = binMap.buffer.slice(startDex);

    log("Mounting massive ZIP buffer locally into JSZip...");

    // Unzip the file
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(zipChunk);

    // Hide loading screen
    uiLoad.style.display = "none";

    // Parse manifest.json to get extension info
    let extName = "EXTENSION WORKSPACE";
    let extAuthor = "Unknown Developer";
    let extIconUrl = "";
    try {
      if (loadedZip.files["manifest.json"]) {
        let manifestStr =
          await loadedZip.files["manifest.json"].async("string");
        let manifestData = JSON.parse(manifestStr);
        let candidateName = manifestData.short_name || manifestData.name;
        if (candidateName) {
          extName = candidateName;
          // Clean up missing localized names if present
          if (extName.includes("__MSG_")) {
            extName = extName
              .replace(/__MSG_(.*)__/gi, "$1")
              .replace(/_/g, " ");
          }
          // Truncate if too long
          if (extName.length > 50) extName = extName.substring(0, 50) + "...";
        }

        // Find the developer's name from manifest fields
        let attributionCandidates = [
          manifestData.author,
          manifestData.developer && manifestData.developer.name,
          manifestData.publisher_display_name,
          manifestData.organization,
          manifestData.creator,
          manifestData.maintainer,
        ];

        let foundAuthor = attributionCandidates.find(
          (c) => c && typeof c === "string" && c.trim().length > 0,
        );

        if (foundAuthor) {
          extAuthor = foundAuthor;
          // Clean localized author names
          if (extAuthor.includes("__MSG_")) {
            extAuthor = extAuthor
              .replace(/__MSG_(.*)__/gi, "$1")
              .replace(/_/g, " ");
          }
        }

        // Find the best quality icon for the extension splash screen
        let svgCands = Object.keys(loadedZip.files).filter((k) =>
          k
            .toLowerCase()
            .match(/^(icon|logo|logo_main|main_icon|128|48)\.svg$/),
        );
        if (svgCands.length > 0) {
          let iconBlob = await loadedZip.files[svgCands[0]].async("blob");
          extIconUrl = URL.createObjectURL(iconBlob);
        } else if (manifestData.icons) {
          // Extract numeric mappings reliably evaluating top tier
          let bestSize = Object.keys(manifestData.icons).sort(
            (a, b) => parseInt(b, 10) - parseInt(a, 10),
          )[0];
          let iconPath = manifestData.icons[bestSize];

          // Normalize path: remove leading slash, dot-slash, and and unify separators
          iconPath = iconPath.replace(/^\.?\//, "").replace(/\\/g, "/");

          if (loadedZip.files[iconPath]) {
            let iconBlob = await loadedZip.files[iconPath].async("blob");
            extIconUrl = URL.createObjectURL(iconBlob);
          }
        }
      }
    } catch (memErr) {}

    // Create a folder tree from the flat zip file paths
    let fileTree = {};
    const files = Object.keys(loadedZip.files).sort();

    files.forEach((path) => {
      let parts = path.split("/").filter((p) => p !== "");
      let current = fileTree;
      for (let i = 0; i < parts.length; i++) {
        let part = parts[i];
        if (!current[part]) {
          // If it's a file, store the path. If it's a folder, create a nested object.
          current[part] =
            i === parts.length - 1 && !loadedZip.files[path].dir ? path : {};
        }
        current = current[part];
      }
    });

    // Render the file tree into the sidebar recursively
    const buildHTMLTree = (node, container, depth = 0) => {
      for (let key in node) {
        if (typeof node[key] === "string") {
          // Handle file items
          let path = node[key];
          let item = document.createElement("div");
          item.className = "file-item";
          item.style.paddingLeft = `${depth * 15 + 20}px`;

          let ext2 = path.split(".").pop().toLowerCase();
          let svgIcon = "";
          
          // Icon mapping for 40+ formats (Code, Docs, Media, Data)
          if (ext2 === "js" || ext2 === "ts" || ext2 === "mjs" || ext2 === "cjs")
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#F7DF1E;flex-shrink:0" viewBox="0 0 448 512"><path d="M400 32H48C21.5 32 0 53.5 0 80v352c0 26.5 21.5 48 48 48h352c26.5 0 48-21.5 48-48V80c0-26.5-21.5-48-48-48zM243.8 381.4c0 43.6-25.6 63.5-52.9 63.5-16.7 0-30.4-3.9-39.7-9l15.3-22.3c8 4.1 19.5 8.4 31.5 8.4 15.3 0 20.1-7.3 20.1-15v-133h25.7v107.4zm108.3 54.3c-15.3 6.6-32.9 9.6-45.9 9.6-29.3 0-48.4-14.2-48.4-39v-4.1c0-25.3 16.1-34.9 44.4-40 22.9-4.1 27.6-6 27.6-11.8v-1.8c0-10-8-15.2-22.4-15.2-14.2 0-26.8 5-37.1 11.2l-13-22c12.3-7.5 31.5-12 52.3-12 30.4 0 47.3 13.5 47.3 40.2v17.4c0 10.4-2.6 15-18.4 16.7-16 1.8-23.7 4.5-23.7 13.9v1.3c0 8.6 7.1 14 20.3 14 12.3 0 24.5-4.1 33.3-8.8l13.7 20.4z"/></svg>`;
          else if (ext2 === "json" || ext2 === "manifest" || ext2 === "map" || ext2 === "lock")
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#CBCB41;flex-shrink:0" viewBox="0 0 24 24"><path d="M12.984 8.25h1.594v1.5H12.984v-1.5zm0-3h1.594v1.5H12.984v-1.5zm0 6h1.594v1.5H12.984v-1.5zm-3.375-6H11.203v1.5H9.609v-1.5zm0 3H11.203v1.5H9.609v-1.5zm0 3H11.203v1.5H9.609v-1.5z"/><path d="M14.25 4.5v1.5H12A.75.75 0 0 0 11.25 6.75v1.5a1.5 1.5 0 0 1-1.5 1.5 1.5 1.5 0 0 1 1.5 1.5v1.5a.75.75 0 0 0 .75.75h2.25v-1.5H12a.75.75 0 0 1-.75-.75V8.25A1.5 1.5 0 0 0 12 6.75H14.25z"/><path d="M9.75 19.5v-1.5H12a.75.75 0 0 0 .75-.75v-1.5a1.5 1.5 0 0 1 1.5-1.5 1.5 1.5 0 0 1-1.5-1.5v-1.5A.75.75 0 0 0 12 11.25H9.75V12.75H12a.75.75 0 0 1 .75.75v1.5A1.5 1.5 0 0 0 14.25 16.5H12z"/></svg>`;
          else if (ext2 === "html" || ext2 === "htm" || ext2 === "xhtml" || ext2 === "php")
            svgIcon = `<svg viewBox="0 0 384 512" style="width:12px;height:12px;margin-right:5px;fill:#E34F26;flex-shrink:0"><path d="M0 32l34.9 395.8L191.5 480l157.6-52.2L384 32H0zm308.2 127.9H124.4l4.1 49.4h175.6l-13.6 148.4-97.9 27v.3h-1.1l-98.7-27.3-6-75.8h47.7L138 320l53.5 14.5 53.7-14.5 6-62.2H84.3L71.5 112.2h241.1l-4.4 47.7z"/></svg>`;
          else if (ext2 === "css" || ext2 === "scss" || ext2 === "less" || ext2 === "sass")
            svgIcon = `<svg viewBox="0 0 384 512" style="width:12px;height:12px;margin-right:5px;fill:#1572B6;flex-shrink:0"><path d="M0 32l34.9 395.8L192 480l157.1-52.2L384 32H0zm308.2 127.9H124.4l4.1 49.4h175.6l-13.6 148.4-97.9 27v.3h-1.1l-98.7-27.3-6-75.8h47.7L138 320l53.5 14.5 53.7-14.5 6-62.2H84.3L71.5 112.2h241.1l-4.4 47.7z"/></svg>`;
          else if (ext2 === "md" || ext2 === "markdown" || ext2 === "txt" || ext2 === "rtf")
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#5eceb3;flex-shrink:0" viewBox="0 0 32 32"><circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" stroke-width="2"/><text x="14" y="22" font-family="Arial" font-size="12" fill="currentColor" font-weight="bold">i</text></svg>`;
          else if (ext2.match(/^(woff2?|ttf|otf|eot)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#dfdfdf;flex-shrink:0" viewBox="0 0 24 24"><path d="M9.93 13.5h4.14L12 7.98 9.93 13.5zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-4.05 16.5l-1.14-3H9.17l-1.12 3H5.96l5.11-13h1.86l5.11 13h-2.09z"/></svg>`;
          else if (ext2.match(/^(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#c792ea;flex-shrink:0" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>`;
          else if (ext2.match(/^(mp4|webm|mkv|mov|avi|wmv|flv|3gp|mpg|mpeg)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#f07178;flex-shrink:0" viewBox="0 0 24 24"><path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
          else if (ext2.match(/^(png|webp|jpg|jpeg|gif|svg|ico|bmp|xcf|psd|ai|eps|tiff|tif|pdf|heic|heif|raw|dng|sketch|fig)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#519aba;flex-shrink:0" viewBox="0 0 32 32"><rect x="4" y="6" width="24" height="20" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="12" r="2" fill="currentColor"/><path d="M4 20l6-6 6 6 4-4 6 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>`;
          else if (ext2.match(/^(pdf|epub|docx?|pptx?|xlsx?|csv|xls)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#FF5722;flex-shrink:0" viewBox="0 0 24 24"><path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>`;
          else if (ext2.match(/^(py|rb|pl|sh|bat|ps1|go|java|c|cpp|cs|h|hpp|rs|swift|kt|kts|sql|yaml|yml|xml)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#8e8e8e;flex-shrink:0" viewBox="0 0 24 24"><path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/></svg>`;
          else if (ext2.match(/^(dat|log|strings|properties|env|conf|ini|reg|manifest)$/i))
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#dfdfdf;flex-shrink:0" viewBox="0 0 24 24"><path d="M4 14h4v-4H4v4zm0 5h4v-4H4v4zM4 9h4V5H4v4zm5 5h12v-4H9v4zm0 5h12v-4H9v4zM9 5v4h12V5H9z"/></svg>`;
          else
            svgIcon = `<svg style="width:12px;height:12px;margin-right:5px;fill:#8e8e8e;flex-shrink:0" viewBox="0 0 32 32"><path d="M6 2v28h20V10l-8-8H6zm10 2l6 6h-6V4z" fill="currentColor"/></svg>`;

          item.innerHTML = `<div style="display:flex;align-items:center;">${svgIcon} ${key}</div>`;

          item.addEventListener("click", async () => {
            document
              .querySelectorAll(".active")
              .forEach((e) => e.classList.remove("active"));
            item.classList.add("active");
            uiTitle.innerText = path;

            // Render pictures
            if (
              path.match(
                /\.(png|jpe?g|gif|webp|ico|bmp|xcf|psd|ai|eps|tiff|tif|heic|heif|raw|dng|sketch|fig)$/i,
              )
            ) {
              uiCode.innerText = "Extracting asset buffer asynchronously...";
              try {
                // For XCF/PSD/PDF etc, the browser might not render them directly in <img>,
                // but we attempt to show them or provide a binary warning if they fail.
                let blob = await loadedZip.files[path].async("blob");
                let bUrl = URL.createObjectURL(blob);
                uiCode.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%;"><img src="${bUrl}" style="max-width: 90%; max-height: 90vh; object-fit: contain; border: 1px solid #333; box-shadow: 0px 4px 20px rgba(0,0,0,0.5);"></div>`;
              } catch (e) {
                uiCode.innerText =
                  "[This high-level format requires an external reader or is a project file. Basic preview blocked.]";
              }
              return;
            }

            let extClick = path.split(".").pop().toLowerCase();

            // Prevent crashing the browser if the user opens a true binary data file like an executable (.exe)
            if (
              extClick.match(
                /^(crx|zip|bin|db|sqlite|gz|tar|7z|rar|dmg|exe|msi|deb|rpm|so|dll|o|pyc|class)$/i,
              )
            ) {
              uiCode.innerHTML =
                "<div style='color:#f44336; white-space:normal;'>[Binary Protection Buffer - High-density binary detected. File content hidden for stability.]</div>";
              return;
            }

            // Render audio files
            if (ext2.match(/^(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac)$/i)) {
              uiCode.innerText = "Extracting audio buffer asynchronously...";
              try {
                let blob = await loadedZip.files[path].async("blob");
                let bUrl = URL.createObjectURL(blob);
                uiCode.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; flex-direction:column; padding: 40px; white-space: normal;">
                                    <svg style="width:64px;height:64px;fill:var(--blue);margin-bottom:20px;" viewBox="0 0 24 24"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>
                                    <audio controls src="${bUrl}" style="width:100%; max-width: 400px;"></audio>
                                    <div style="margin-top: 15px; color: var(--subtext); font-family: 'Google Sans', sans-serif;">${key}</div>
                                </div>`;
              } catch (e) {
                uiCode.innerText = "[Error Decoding Audio Structure]";
              }
              return;
            }

            // Render video files
            if (ext2.match(/^(mp4|webm|mkv|mov|avi|wmv|flv|3gp|mpg|mpeg)$/i)) {
              uiCode.innerText = "Extracting video buffer asynchronously...";
              try {
                let blob = await loadedZip.files[path].async("blob");
                let bUrl = URL.createObjectURL(blob);
                uiCode.innerHTML = `<div style="display:flex; justify-content:center; align-items:center; height:100%; padding: 20px;">
                                    <video controls src="${bUrl}" style="max-width:100%; max-height:70vh; border-radius:8px; box-shadow:0 10px 30px rgba(0,0,0,0.5);"></video>
                                </div>`;
              } catch (e) {
                uiCode.innerText = "[Error Decoding Video Structure]";
              }
              return;
            }

            // Render font files with sample text
            if (extClick.match(/^(woff2?|ttf|otf|eot)$/i)) {
              uiCode.innerText = "Extracting font matrices asynchronously...";
              try {
                let blob = await loadedZip.files[path].async("blob");
                let bUrl = URL.createObjectURL(blob);
                let fontId = "font_" + Math.random().toString(36).substr(2, 9);

                uiCode.innerHTML = `<style>
                                    @font-face { font-family: '${fontId}'; src: url('${bUrl}'); }
                                </style>
                                <div style="font-family: '${fontId}', sans-serif !important; white-space: normal; line-height: 1.4; color: #e3e3e3; padding: 20px; text-align: center; height:100%; display:flex; flex-direction:column; justify-content:center;">
                                    <div style="font-size: 42px; margin-bottom: 25px; border-bottom: 1px solid #333; padding-bottom: 20px; font-weight: normal; color:var(--blue);">${key}</div>
                                    <div style="font-size: 36px; margin-bottom: 20px; font-weight: normal;">The quick brown fox jumps over the lazy dog.</div>
                                    <div style="font-size: 26px; margin-bottom: 15px; font-weight: normal;">ABCDEFGHIJKLMNOPQRSTUVWXYZ</div>
                                    <div style="font-size: 26px; margin-bottom: 15px; font-weight: normal;">abcdefghijklmnopqrstuvwxyz</div>
                                    <div style="font-size: 26px; margin-bottom: 15px; font-weight: normal;">0123456789</div>
                                    <div style="font-size: 26px; font-weight: normal; word-break: break-all; max-width:80%; margin: 0 auto;">!@#$%^&*()_+-=[]{}|;':",./<>?</div>
                                </div>`;
              } catch (e) {
                uiCode.innerText = "[Error Decoding Font Elements]";
              }
              return;
            }

            // Render Markdown files using the 'marked' library
            if (extClick === "md") {
              uiCode.innerText =
                "Processing Markdown documentation dynamically...";
              try {
                let str = await loadedZip.files[path].async("string");
                if (typeof marked !== "undefined") {
                  let htmlContent = marked.parse(str);
                  uiCode.innerHTML = `<div class="markdown-preview" style="background:transparent; color:#e3e3e3; padding: 10px 40px; margin: 0 auto; width: 100%; max-width: 900px; white-space: normal; line-height: 1.6; font-size:15px; font-family:'Google Sans', sans-serif;">
                                        ${htmlContent}
                                    </div>`;
                  // Highlight code blocks inside the markdown
                  uiCode.querySelectorAll("pre code").forEach((el) => {
                    if (!el.className) el.className = "language-clike";
                    Prism.highlightElement(el);
                  });
                } else {
                  uiCode.innerText = "Markdown parser disconnected globally.";
                }
              } catch (err) {
                uiCode.innerText = "[Error Resolving Markdown Elements]";
              }
              return;
            }

            uiCode.innerText = "Extracting string buffer asynchronously...";
            try {
              // Read text file contents
              let str = await loadedZip.files[path].async("string");

              // Match file extension to Prism language for syntax highlighting
              let ext = path.split(".").pop().toLowerCase();
              let lang = "clike";

              // Un-minify source code so it's actually readable (using js-beautify)
              if (
                ext === "js" ||
                ext === "json" ||
                ext === "ts" ||
                ext === "manifest"
              ) {
                if (typeof js_beautify !== "undefined")
                  str = js_beautify(str, {
                    indent_size: 2,
                    space_in_empty_paren: true,
                  });
              } else if (ext === "html" || ext === "xml" || ext === "htm" || ext === "svg") {
                if (typeof html_beautify !== "undefined")
                  str = html_beautify(str, { indent_size: 2 });
              } else if (ext === "css" || ext === "scss" || ext === "less") {
                if (typeof css_beautify !== "undefined")
                  str = css_beautify(str, { indent_size: 2 });
              }

              if (ext === "js" || ext === "ts" || ext === "mjs" || ext === "cjs")
                lang = "javascript";
              else if (ext === "css" || ext === "scss" || ext === "less")
                lang = "css";
              else if (
                ext === "html" ||
                ext === "htm" ||
                ext === "xml" ||
                ext === "svg" ||
                ext === "php"
              )
                lang = "markup";
              else if (ext === "json" || ext === "manifest" || ext === "map")
                lang = "json";
              else if (ext === "py") lang = "python";
              else if (ext === "yaml" || ext === "yml") lang = "yaml";
              else if (ext === "sql") lang = "sql";
              else if (
                ext === "dat" ||
                ext === "txt" ||
                ext === "log" ||
                ext === "strings" ||
                ext === "properties" ||
                ext === "env" ||
                ext === "conf" ||
                ext === "ini"
              )
                lang = "clike";

              // Renders output cleanly escaping syntax injecting directly wrapping Prism highlights
              uiCode.innerHTML = `<code class="language-${lang}">${escapeHtml(str)}</code>`;
              Prism.highlightElement(uiCode.querySelector("code"));
            } catch (e) {
              uiCode.innerText =
                "[Error Decoding File Parameters Structurally]";
            }
          });
          container.appendChild(item);
        } else {
          // Handle folder items
          let details = document.createElement("details");
          // Keep folders collapsed by default
          details.open = false;

          let summary = document.createElement("summary");
          summary.className = "file-item folder";
          summary.style.paddingLeft = `${depth * 15 + 5}px`;

          // Folder icon
          summary.innerHTML = `<div style="display:flex;align-items:center;">
                        <svg style="width:12px;height:12px;margin-right:5px;fill:#519aba;flex-shrink:0" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg> 
                        ${key}
                    </div>`;

          details.appendChild(summary);
          let folderContainer = document.createElement("div");

          // Render folder contents recursively
          buildHTMLTree(node[key], folderContainer, depth + 1);
          details.appendChild(folderContainer);
          container.appendChild(details);
        }
      }
    };

    let rootDetails = document.createElement("details");
    rootDetails.open = true; // Keep the root folder open
    let rootSummary = document.createElement("summary");
    rootSummary.className = "file-item folder";
    rootSummary.style.paddingLeft = `5px`;
    // Create the root workspace folder UI
    rootSummary.innerHTML = `<div style="display:flex;align-items:center;color:#fff;padding:2px 0;">
            <svg style="width:14px;height:14px;margin-right:5px;fill:#ccc;flex-shrink:0;transition:0.2s" viewBox="0 0 24 24"><path d="M7.41 15.41L12 10.83l4.59 4.58L18 14l-6-6-6 6z"/></svg> 
            <span style="font-weight:bold; font-size:11.5px; letter-spacing:0.5px;text-transform:uppercase;">${extName}</span>
        </div>`;

    let rootContainer = document.createElement("div");
    // Start building the UI passing the full tree
    buildHTMLTree(fileTree, rootContainer, 1);

    rootDetails.appendChild(rootSummary);
    rootDetails.appendChild(rootContainer);
    uiSidebar.appendChild(rootDetails);

    let logoHtml = `<img src="../icons/icon128.png" style="width:110px;height:110px;margin-bottom:30px;opacity:0.9;filter: drop-shadow(0 4px 20px rgba(0,0,0,0.5));">`;

    if (extIconUrl) {
      logoHtml = `<img src="${extIconUrl}" style="width:120px;height:120px;object-fit:contain;margin-bottom:25px;filter: drop-shadow(0 15px 35px rgba(0,0,0,0.6)); border-radius:24px;">`;
    }

    // Parse metadata from URL
    const urlName = urlParams.get("title");
    const isVerified = urlParams.get("v") === "1";
    const urlAuthor = urlParams.get("author");

    // Priority: URL Title (Official) > Manifest Short Name > Manifest Name
    if (urlName) {
      extName = urlName
        .replace(/- Chrome Web Store/i, "")
        .replace(/- Microsoft Edge Addons/i, "")
        .trim();
    }

    // Priority: URL Author (Store Official) > Internal Manifest Author
    if (urlAuthor && urlAuthor !== "undefined") {
      extAuthor = urlAuthor;
    }

    // Final Label Logic: If no name was found, label based on store verification status
    if (extAuthor === "Unknown Developer") {
      extAuthor = isVerified ? "Verified Developer" : "Unknown Developer";
    }

    // Build the splash screen UI
    uiTitle.innerText = "View Extension Source Code";

    let verifiedBadge = isVerified
      ? `<svg style="width:20px;height:20px;fill:#60cdff;margin-left:8px;vertical-align:middle;" viewBox="0 0 24 24"><path d="M23,12L20.56,9.22L20.9,5.54L17.29,4.72L15.4,1.54L12,3L8.6,1.54L6.71,4.72L3.1,5.53L3.44,9.21L1,12L3.44,14.78L3.1,18.47L6.71,19.29L8.6,22.47L12,21L15.4,22.46L17.29,19.28L20.9,18.46L20.56,14.78L23,12M10,17L6,13L7.41,11.59L10,14.17L16.59,7.58L18,9L10,17Z"/></svg>`
      : "";

    uiCode.innerHTML = `<div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; white-space: normal; color: #fff; font-family: 'Google Sans', sans-serif;">
            ${logoHtml}
            <div style="font-size: 38px; font-weight: 500; margin-bottom: 12px; letter-spacing: 0.5px; text-align:center; display:flex; align-items:center; justify-content:center;">
                ${extName}${verifiedBadge}
            </div>

        <br>    
            <div style="font-size: 13.5px; padding: 12px 24px; background: rgba(168,199,250,0.08); border: 1px solid rgba(168,199,250,0.25); border-radius: 12px; color: var(--blue); letter-spacing:0.4px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);">
                &lt; Open a source file to evaluate targets &gt;
        </div>`;
  } catch (e) {
    log("FATAL FAILURE: " + e.message);
  }
};

// Execute program
init();
