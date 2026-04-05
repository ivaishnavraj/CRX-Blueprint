/**
 * File: popup.js
 * Purpose: This script controls the Extension Popup window.
 * Why it's needed: It handles the buttons you click to download extensions or view code.
 * If not used: You'll still be able to use the right-click menu, but the popup UI won't work.
 */

const dom = {
  z: document.getElementById("actZip"),
  c: document.getElementById("actCrx"),
  v: document.getElementById("actView"),
  crxToZip: document.getElementById("fileCrxToZip"),
  zipToCrx: document.getElementById("fileZipToCrx"),
  out: document.getElementById("statusText"),
  pWrap: document.getElementById("pWrap"),
  pBar: document.getElementById("pBar"),
  winContent: document.getElementById("winContent"),
  btnClose: document.getElementById("btnClose"),
};

// Close button logic
dom.btnClose.addEventListener("click", () => {
  window.close();
});

const setStatus = (text) => {
  dom.out.innerText = text;
};

const resetUI = () => {
  dom.pWrap.style.display = "none";
  dom.pBar.style.width = "0%";
  setStatus("Processing...");
};

// Listen for progress updates from the background task
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.status === "streaming") {
    dom.pWrap.style.display = "block";
    dom.pBar.style.width = `${msg.progress}%`;
    setStatus(`Receiving: ${Math.floor(msg.progress)}%`);
  } else if (msg.status === "unpacking") {
    setStatus("Decompressing...");
  } else if (msg.status === "done") {
    dom.pBar.style.width = "100%";
    setStatus("Completed.");
    setTimeout(() => {
      dom.pWrap.style.display = "none";
      dom.pBar.style.width = "0%";
      setStatus("");
    }, 3000);
  }
});

// Main function to tell the background script what to do
const executeCmd = async (format) => {
  resetUI();
  let tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return setStatus("Error: No active tab found.");

  let isEdge = tabs[0].url.includes("microsoft");
  // Find the extension ID in the URL
  let match = tabs[0].url.match(/\/([a-z]{32})(?:[\/?#]|$)/);

  if (!match) return setStatus("Error: Ext hash missing.");

  let author = "";
  try {
    // Inject a small script to grab the "Offered by" developer name from the page
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabs[0].id },
      func: () => {
        // Method 1: Check the header for the author link
        const headerLink = document.querySelector('a.cJI8ee[href*="/collection/by_"]');
        if (headerLink) return headerLink.textContent.trim();

        // Method 2: Search the text for "Offered by"
        const allDivs = Array.from(document.querySelectorAll("div"));
        const offeredByLabel = allDivs.find(
          (el) => el.textContent.trim() === "Offered by" && el.children.length === 0,
        );

        if (offeredByLabel && offeredByLabel.nextElementSibling) {
          return offeredByLabel.nextElementSibling.textContent.trim();
        }

        // Method 3: Check edge-specific developer name
        const edgeAuthor = document.querySelector('[class*="developerName"]');
        if (edgeAuthor) return edgeAuthor.innerText.trim();

        return "";
      },
    });
    if (results && results[0] && results[0].result) author = results[0].result;
  } catch (e) {
    console.error("DOM Analysis Failure:", e);
  }

  // Send the specific task (ZIP/CRX/VIEW) along with the ID and author info
  chrome.runtime.sendMessage({
    cmd: "executeFetch",
    build: format,
    identifier: match[1],
    pageTitle: tabs[0].title,
    isEdge: isEdge,
    author: author,
  });
};

// Setup click listeners for the main buttons
dom.z.addEventListener("click", () => executeCmd("archive"));
dom.c.addEventListener("click", () => executeCmd("binary"));
dom.v.addEventListener("click", () => executeCmd("view"));

// Handle local file conversion (CRX to ZIP)
dom.crxToZip.addEventListener("change", async (ev) => {
  resetUI();
  let f = ev.target.files[0];
  if (!f) return;
  setStatus(`Extracting CRX...`);

  try {
    let b = await f.arrayBuffer();
    let mapData = new DataView(b);
    let sv = mapData.getUint32(4, true);
    let ds = 0;

    // Slice off headers based on version
    if (sv === 2) {
      ds = 16 + mapData.getUint32(8, true) + mapData.getUint32(12, true);
    } else if (sv === 3) {
      ds = 12 + mapData.getUint32(8, true);
    } else {
      throw new Error("Invalid CRX format");
    }

    let out = b.slice(ds);
    let dlBlob = new Blob([out], { type: "application/zip" });

    chrome.downloads.download({
      url: URL.createObjectURL(dlBlob),
      filename: f.name.replace(/\.crx$/i, "") + ".zip",
    });
    setStatus("Successfully extracted to ZIP.");
    setTimeout(() => setStatus(""), 3000);
  } catch (e) {
    setStatus("Error: Corrupted package format.");
  }
});

// Handle local file conversion (ZIP to CRX)
dom.zipToCrx.addEventListener("change", async (ev) => {
  resetUI();
  let f = ev.target.files[0];
  if (!f) return;
  setStatus(`Converting ZIP to CRX...`);

  try {
    const zip = await JSZip.loadAsync(f);
    const manifestFile = zip.file("manifest.json");

    if (!manifestFile) throw new Error("Missing manifest.json");

    const zipBlob = await zip.generateAsync({ type: "uint8array" });

    const pubKey = new Uint8Array(16).fill(0);
    const signature = new Uint8Array(16).fill(0);

    const headerLen = 16;
    const crxSize = headerLen + pubKey.length + signature.length + zipBlob.length;
    const crxBuffer = new ArrayBuffer(crxSize);
    const view = new DataView(crxBuffer);

    view.setUint8(0, 67); view.setUint8(1, 114); view.setUint8(2, 50); view.setUint8(3, 52);
    view.setUint32(4, 2, true);
    view.setUint32(8, pubKey.length, true);
    view.setUint32(12, signature.length, true);

    const u8 = new Uint8Array(crxBuffer);
    u8.set(pubKey, 16);
    u8.set(signature, 16 + pubKey.length);
    u8.set(zipBlob, 16 + pubKey.length + signature.length);

    const dlBlob = new Blob([crxBuffer], { type: "application/x-chrome-extension" });
    chrome.downloads.download({
      url: URL.createObjectURL(dlBlob),
      filename: f.name.replace(/\.zip$/i, "") + ".crx",
    });

    setStatus("Successfully converted to CRX.");
    setTimeout(() => setStatus(""), 3000);
  } catch (e) {
    setStatus(`Error: ${e.message || "Invalid archive"}`);
  }
});
