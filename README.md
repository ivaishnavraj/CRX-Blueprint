<!-- Academia ReVanced Banner -->
<img src="https://github.com/ivaishnavraj/CRX-Blueprint/blob/main/GithubReadMeFiles/CRX%20-%20Github%20Preview.png" alt="crx - BLUEPRINT" width="100%">

## 🧩 CRX Blueprint
Seamlessly extract extension packages as `.ZIP` or `.CRX` files and view the source code of any extension.

---

### 🔹 Get Here - Stable Release (v1.0)

<p align="left">
  <!-- Firefox -->
    <a href="https://chromewebstore.google.com/detail/crx-blueprint/ojfoaejaeknkifnmpjhjckelfbpfkgdj"><img src="https://github.com/ivaishnavraj/CRX-Blueprint/blob/main/GithubReadMeFiles/ChromeWebStore.png" alt="Download for Chrome" height="48" /></a>
   <!-- <a href="https://github.com"><img src="https://github.com/ivaishnavraj/PixterialTab/blob/main/images/github.png" alt="Download from GitHub" height="48" /></a> -->
   <!-- <a href="https://chromewebstore.google.com"><img src="https://github.com/ivaishnavraj/AcademiaRevanced/blob/main/EdgeAdd-ons.png" alt="Download for Edge" height="48" /></a> -->
</p>

> *Available in Chromium-based desktop browsers.*
---
## 🚀 Features

### 1. Instant Extraction & Conversion
* **Right-Click Integration**: Instantly rip source code from any extension on the Chrome Web Store or Edge Add-ons.
* **Binary Slicing**: Decodes the complex `.CRX` binary header using `DataView` to produce a pure `.ZIP` archive.
* **Local File Support**: Converts local `.crx` files to `.zip` format in seconds.

### 2. Professional IDE Environment
* **Zero-Server Processing**: All extraction, decompression, and formatting happen 100% inside your browser's local sandbox.
* **Smart Formatting**: Dynamically "un-minifies" (beautifies) JS, CSS, and HTML files for standard developer readability.
* **Metadata Insights**: Automatically scrapes developer labels and official store branding to verify authenticity.

### 3. Universal File Support (40+ Formats)
The IDE includes a multi-renderer pipeline to visualize nearly any extension asset:
* **Code**: Syntax highlighting for JavaScript, TypeScript, Python, PHP, SQL, YAML, XML, and more.
* **Visuals**: High-fidelity previews for PNG, WEBP, SVG, ICO, and professional PSD/AI design files.
* **Media**: Built-in player for MP3, WAV, MP4, and WebM.
* **Fonts**: Live typography previews for `.ttf`, `.woff2`, and `.otf` files.
* **Data**: Native reading for `.json`, `.manifest`, `.env`, `.log`, and `.dat` files.

---

## 🏗️ Technical Stack

* **Core Logic**: Vanilla JavaScript (ES6+), HTML5, CSS3.
* **Parsing Engines**: **JSZip** for archive handling and **DataView** for low-level binary slicing.
* **Rendering Libraries**:
    * **Prism.js**: Code syntax highlighting.
    * **Beautify-JS**: Code un-minification and formatting.
    * **Marked.js**: GitHub-style Markdown rendering.

---

## 🔏 Privacy & Safety

CRX Blueprint is built for security researchers and developers with a **Zero-Persistence** model:
* **Local Execution**: No data ever leaves your machine or touches an intermediary server.
* **Memory Management**: Extensions are unpacked into RAM; closing the viewer tab automatically wipes all data.
* **No Tracking**: The tool does not track your browsing history, identity, or the extensions you view.

---

> *The developer's lens for the Chrome Web Store.*

 <p align="right">
  <a href="https://buymeacoffee.com/ivaishnavraj"><img src="https://github.com/ivaishnavraj/CRX-Blueprint/blob/main/GithubReadMeFiles/buymeacoffee.png"  target="_blank" alt="Buy Me A Coffee" height="32" /></a>
 </p>
