# TurboCompress Studio 🎬⚡️

**High-Performance Batch Vertical Video Transcoder for Nikon Z8**  
*DaVinci Resolve Studio 20 Cut & Inspector Layout • ColorOS 17 Fluid Design • Apple Silicon VideoToolbox Hardware Acceleration*

---

## 🌟 Overview
**TurboCompress Studio** is a native, ultra-fast batch transcoding suite built specifically for commercial filmmakers, social media creators, and photographers handling mass vertical shoots (2,100+ clips) from **Nikon Z8 / Z9**.

It brings the familiar, professional precision of **DaVinci Resolve Studio** with a clean single-window interface, allowing 1-click rotation, live color grading, audio routing, and hardware-accelerated batch export at **250+ FPS** directly to Apple Silicon encoders.

---

## ✨ Key Features

### 1. 📐 Nikon Z8 Orientation & 3D Transform
* **Instant 270° (-90°) Quick Button:** Rotates sideways-shot 16:9 Nikon files to vertical 9:16 in a single click.
* **Full Frame Fit (Uncropped):** Mathematically maps the full sensor frame without losing a single pixel of the subject.
* **Scaling Mode:** Toggle between `Fit (Show Full Frame)`, `Crop (Fill Vertical 9:16)`, and `Stretch`.
* **Precision Controls:** Zoom X/Y, Position X/Y, Anchor Point X/Y, 3D Pitch, 3D Yaw, and Horizontal/Vertical Flip.

### 2. 🎨 Nikon Color & Tone Engine
* **Nikon N-Log ➔ Rec.709 (Auto-Contrast):** Golden ratio curve (+18% Contrast, +22% Saturation, shadow lift) for vibrant, punchy clips ready for social delivery.
* **Nikon Rich Tone Portrait (Skin Glow):** Enhances skin tones with soft rosy warmth and gentle highlight roll-off.
* **Nikon Standard Portrait & Vivid:** Specialized profiles for natural skin and punchy outdoor landscapes.
* **Nikon Flat & Deep Tone Monochrome:** Low-contrast cine profile and high-contrast B&W film style.
* **Custom 3D LUT Support:** Browse and apply external `.cube` files directly.
* **Tone Strength Slider:** Adjust intensity from 0% to 100%.

### 3. 🖥️ Professional Dual Monitor Comparison
* **Single 9:16 Center Monitor:** Real-time hardware preview with scrub slider and digital timecode.
* **2-Up (Side-by-Side Dual Comparison):** Split view comparing raw sensor footage (Before) and graded vertical output (After).
* **Split Wipe (A/B Curtain):** Drag interactive wipe curtain across the screen to inspect grading boundaries.
* **Instant Bypass:** Quick `⚡️ Bypass` button to preview raw camera output instantly.

### 4. 🚀 Deliver Page (1:1 DaVinci Resolve Replication)
* **File Subtab:** Source name / Custom name, Unique filenames, Subfolders, Preserve source directory levels (From head / tail), Replace existing in place.
* **Audio Subtab:** Export Audio toggle, Codec selection (AAC, Linear PCM, Direct Copy Pass-through), Constant / Variable Bit Rate (up to 320 Kb/s), 2-Channel Stereo / 1-Channel Mono / Same as source.
* **Smart Resume:** Skips already-rendered clips automatically when resuming huge batches.
* **Parallel Engine:** 2 to 4 workers parallel processing for M1/M2/M3/M4 Max and Ultra chips.

---

## 🛠️ Tech Stack & Architecture
* **Frontend Shell:** Native macOS Objective-C / WKWebView shell with hairline borders and ColorOS 17 glassmorphism.
* **Backend Server:** Lightweight Python 3 HTTP server (`server.py`) handling REST API and video streaming with range-request chunking.
* **Engine:** FFmpeg hardware-accelerated with Apple Silicon `h264_videotoolbox` / `hevc_videotoolbox`.

---

## 🚀 Getting Started

### macOS Native App
1. Run `./TurboCompressStudio` directly, or open `TurboCompress Studio.app`.
2. Or launch via terminal:
   ```bash
   python3 server.py
   ```
   Open `http://127.0.0.1:8765` in your browser.

### Windows
Launch `server.py` with Python 3 and FFmpeg installed in PATH.

---

## 📄 License
MIT License. Created for high-volume video productions.
