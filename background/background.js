/**
 * File: background.js
 * Purpose: This is the "brain" of the extension. It runs in the background to handle the heavy lifting.
 * Why it's needed: It builds the download links, fetches the CRX files from the store, and converts them to ZIP files.
 * If not used: The extension won't be able to download anything or open the source code viewer.
 */

// Step 1: Create the store download link with your browser's details
const synthesizeParams = () => {
  let navUA = navigator.userAgent || "";
  let systemArch = navUA.includes("x64") ? "x86-64" : "arm";
  let verQuery = /(?:Chrome|Edge)\/([\d\.]+)/.exec(navUA);
  let vFallback = verQuery ? verQuery[1] : "105.0.0.0";
  
  // These parameters tell Google/Edge we are a real browser wanting a CRX file
  return `prodversion=${vFallback}&nacl_arch=${systemArch}&acceptformat=crx2,crx3`;
};

// Step 2: Clean up the messy page title for the final file name
const cleanFileName = (titleStr, fallbackMask) => {
  let base = String(titleStr)
    .replace(/- Chrome Web Store/i, "")
    .replace(/- Microsoft Edge Addons/i, "");

  // Remove symbols that Windows/Mac don't like in file names
  let sanitized = base.replace(/[<>:"\/\\|?*\x00-\x1F]/g, "").trim();
  return sanitized.length > 1 ? sanitized : fallbackMask;
};

// Step 3: Handle the user's request (Download ZIP, Download CRX, or View Code)
const processTask = async (taskDef) => {
  let { build, identifier, pageTitle, isEdge, author } = taskDef;
  let computedName = cleanFileName(pageTitle, identifier);

  // Build the official download link (Default: Chrome Web Store)
  let computedUrl =
    `https://clients2.google.com/service/update2/crx?response=redirect&x=id%3D${identifier}%26installsource%3Dondemand%26uc&` +
    synthesizeParams();

  // If the user is on the Edge store, swap to the Edge link
  if (isEdge) {
    computedUrl = `https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&prod=chromiumcrx&prodchannel=&x=id%3D${identifier}%26installsource%3Dondemand%26uc`;
  }

  // Option A: Just download the raw .CRX file
  if (build === "binary") {
    chrome.downloads.download({
      url: computedUrl,
      filename: `${computedName}.crx`,
    });
    chrome.runtime.sendMessage({ status: "done" }).catch(() => {});
  }
  // Option B: Open the full source code IDE in a new tab
  else if (build === "view") {
    let isVerified = pageTitle.includes("✓") || pageTitle.includes("Verified");
    let viewURL = `editor/viewer.html?id=${identifier}${isEdge ? "&edge=1" : ""}&title=${encodeURIComponent(pageTitle)}&v=${isVerified ? 1 : 0}${author ? `&author=${encodeURIComponent(author)}` : ""}`;
    chrome.tabs.create({ url: viewURL });
  }
  // Option C: Fetch the CRX, convert it to ZIP, and then download
  else if (build === "archive") {
    try {
      // Start the progress bar in the popup
      chrome.runtime.sendMessage({ status: "streaming", progress: 0 }).catch(() => {});

      // Fetch the file from the store
      let remoteCall = await fetch(computedUrl, { redirect: "follow" });
      let totalSize = remoteCall.headers.get("content-length");
      let total = totalSize ? parseInt(totalSize, 10) : 0;

      let reader = remoteCall.body.getReader();
      let chunks = [];
      let received = 0;

      // Stream the download chunk by chunk
      while (true) {
        let { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;

        // Tell the popup how far along we are
        let pct = total ? (received / total) * 100 : Math.min((received / 5000000) * 100, 95);
        chrome.runtime.sendMessage({ status: "streaming", progress: pct }).catch(() => {});
      }

      chrome.runtime.sendMessage({ status: "unpacking" }).catch(() => {});

      // Combine all chunks into one big block of data
      let binMap = new Uint8Array(received);
      let offset = 0;
      for (let c of chunks) {
        binMap.set(c, offset);
        offset += c.length;
      }

      // Slicing the CRX header: This "unlocks" the ZIP file hidden inside
      let structView = new DataView(binMap.buffer);
      let versionFlag = structView.getUint32(4, true);
      let startDex = 0;

      if (versionFlag === 2) {
        startDex = 16 + structView.getUint32(8, true) + structView.getUint32(12, true);
      } else if (versionFlag === 3) {
        startDex = 12 + structView.getUint32(8, true);
      } else {
        throw new Error("Invalid CRX Header");
      }

      // Convert the pure ZIP data into a file you can download
      let zipChunk = binMap.buffer.slice(startDex);
      let asReader = new FileReader();

      asReader.onloadend = () => {
        chrome.downloads.download({
          url: asReader.result,
          filename: `${computedName}.zip`,
        });
        chrome.runtime.sendMessage({ status: "done" }).catch(() => {});
      };

      asReader.readAsDataURL(new Blob([zipChunk], { type: "application/zip" }));
    } catch (catastrophic) {
      console.error("Task failure");
    }
  }
};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((pld) => {
  if (pld.cmd === "executeFetch") {
    processTask(pld);
  }
});

// Setup the Right-Click (Context) Menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "root_ctx",
      title: "Extension Extractor",
      contexts: ["page"],
    });

    chrome.contextMenus.create({
      id: "go_bin",
      title: "Download Case (.CRX)",
      parentId: "root_ctx",
      contexts: ["page"],
    });

    chrome.contextMenus.create({
      id: "go_arc",
      title: "Download Archive (.ZIP)",
      parentId: "root_ctx",
      contexts: ["page"],
    });

    chrome.contextMenus.create({
      id: "go_view",
      title: "View Source Code",
      parentId: "root_ctx",
      contexts: ["page"],
    });
  });
});

// Listen for when a user clicks the Right-Click menu option
chrome.contextMenus.onClicked.addListener((data, currentTab) => {
  let foundHash = currentTab.url.match(/\/([a-z]{32})(?:[\/?#]|$)/);
  if (!foundHash) return;

  let extractionHash = foundHash[1];
  let isEdge = currentTab.url.includes("microsoft");

  // Route to the correct task
  if (data.menuItemId === "go_bin") {
    processTask({ build: "binary", identifier: extractionHash, pageTitle: currentTab.title, isEdge });
  } else if (data.menuItemId === "go_arc") {
    processTask({ build: "archive", identifier: extractionHash, pageTitle: currentTab.title, isEdge });
  } else if (data.menuItemId === "go_view") {
    processTask({ build: "view", identifier: extractionHash, pageTitle: currentTab.title, isEdge });
  }
});
