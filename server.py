#!/usr/bin/env python3
"""
TurboCompress Studio - High Performance Backend Server
Powers the DaVinci Resolve Cut Page Web App with Apple Silicon Hardware Engine
"""

import os
import sys
if getattr(sys, "frozen", False):
    APP_DIR = os.path.dirname(os.path.dirname(os.path.abspath(sys.executable)))
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
_LOCAL_PY_DEPS = os.path.join(APP_DIR, "py_deps")
if os.path.isdir(_LOCAL_PY_DEPS) and _LOCAL_PY_DEPS not in sys.path:
    sys.path.insert(0, _LOCAL_PY_DEPS)
import re
import json
import time
import shutil
import signal
import hashlib
import urllib.parse
import threading
import subprocess
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import gc
import tempfile
import urllib.request
import zipfile

ZCUT_VERSION = "2.1.6"
UPDATE_MANIFEST_URL = "https://memories-stack.github.io/turbocompress-studio/version.json"
DOWNLOAD_PAGE_URL = "https://memories-stack.github.io/turbocompress-studio/"
SERVER_INSTANCE = None

THUMB_CACHE_DIR = os.path.join(tempfile.gettempdir(), "tc_thumbs")

def get_user_desktop():
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    if os.path.exists(desktop):
        return desktop
    return os.path.expanduser("~")

def get_default_output_dir():
    custom = "/Users/siamratchongtong/Desktop/STD_VT/100NC_Z8/_vertical_export"
    if os.path.exists(os.path.dirname(custom)):
        return custom
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    return os.path.join(desktop if os.path.exists(desktop) else os.path.expanduser("~"), "ZCut_Export")

try:
    import fcntl
except ImportError:
    fcntl = None

_PICKER_LOCK = threading.Lock()
_LAST_PICKER_CLOSE_TS = 0.0

def purge_system_and_process_ram(filepath=None):
    """
    Actively clear RAM, purge file from OS unified buffer cache,
    and trigger generation-2 garbage collection after every export task.
    Prevents memory leaks, RAM bloat, and machine throttling on mass batch jobs.
    """
    if filepath and os.path.exists(filepath):
        if sys.platform == "darwin" and fcntl is not None:
            try:
                # F_NOCACHE flushes the file from macOS Unified Buffer Cache (UBC)
                with open(filepath, "rb") as f:
                    fcntl.fcntl(f.fileno(), fcntl.F_NOCACHE, 1)
            except Exception:
                pass
        elif hasattr(os, "posix_fadvise"):
            try:
                with open(filepath, "rb") as f:
                    os.posix_fadvise(f.fileno(), 0, os.path.getsize(filepath), os.POSIX_FADV_DONTNEED)
            except Exception:
                pass

    try:
        gc.collect(2)
    except Exception:
        pass

    # Auto-prune thumbnail cache if it exceeds 150 thumbnails to keep disk & RAM minimal
    try:
        thumb_cache_dir = THUMB_CACHE_DIR
        if os.path.exists(thumb_cache_dir):
            entries = sorted(
                (e for e in os.scandir(thumb_cache_dir) if e.is_file()),
                key=lambda x: x.stat().st_mtime
            )
            if len(entries) > 150:
                for old_entry in entries[:-100]:
                    try:
                        os.remove(old_entry.path)
                    except Exception:
                        pass
    except Exception:
        pass

    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.psapi.EmptyWorkingSet(ctypes.windll.kernel32.GetCurrentProcess())
        except Exception:
            pass

PORT = 8765
WEB_DIR = os.path.join(APP_DIR, "web")
SETTINGS_PATH = os.path.expanduser("~/.turbocompress_studio_settings.json")

DEFAULT_SETTINGS = {
    "rotation": 0.0,
    "scaling": "fit",
    "zoomX": 1.0,
    "zoomY": 1.0,
    "zoomLinked": True,
    "posX": 0.0,
    "posY": 0.0,
    "anchorX": 0.0,
    "anchorY": 0.0,
    "pitch": 0.0,
    "yaw": 0.0,
    "flipH": False,
    "flipV": False,
    "cropL": 0.0,
    "cropR": 0.0,
    "cropT": 0.0,
    "cropB": 0.0,
    "cropSoftness": 0.0,
    "speed": 100.0,
    "speedDirection": "forward",
    "nikonProfile": "none",
    "nikonStrength": 0,
    "customLutPath": "",
    "brightness": 0.05,
    "contrast": 1.06,
    "shadows": 40.0,
    "highlights": -10.0,
    "whites": 0.0,
    "blacks": 15.0,
    "texture": 5.0,
    "clarity": 10.0,
    "dehaze": 0.0,
    "vibrance": 10.0,
    "saturation": 1.1,
    "temperature": 12.0,
    "tint": 2.0,
    "skinSoftening": 0,
    "portraitHue": 0,
    "portraitBrightness": 0,
    "denoiseMode": "normal",
    "denoiseSpatial": 0.0,
    "denoiseTemporal": 0.0,
    "conflictAction": "overwrite",
    "outputPath": "",
    "fileNamePattern": "SourceName",
    "renderMode": "individual",
    "format": "mp4",
    "codec": "h264",
    "resolution": "1080x1920",
    "resW": "1080",
    "resH": "1920",
    "verticalRes": True,
    "qualityMode": "auto",
    "bitrateKbps": "8000",
    "exportAudio": True,
    "audioCodec": "aac",
    "audioBitrate": "320",
    "audioChannels": "2",
    "filenameUses": "source",
    "fileSubfolder": "",
    "smartResume": True,
    "workers": 2,
    "renderSpeed": "max",
    "theme": "auto",
    "namingStyle": "original_same",
    "customFileName": "",
    "colorSlice": {
        "master": {"den": 0, "denDepth": 0, "sat": 1, "satBal": 0, "satDepth": 0, "hue": 0},
        "red": {"center": 0, "hue": 0, "den": 0, "sat": 1},
        "skin": {"center": 0, "hue": 0, "den": -0.23, "sat": 1},
        "yellow": {"center": 0, "hue": 0, "den": -0.13, "sat": 1},
        "green": {"center": 0, "hue": 0, "den": 0, "sat": 1},
        "cyan": {"center": 0, "hue": 0, "den": 0, "sat": 1},
        "blue": {"center": 0, "hue": 0, "den": 0, "sat": 1},
        "magenta": {"center": 0, "hue": 0, "den": 0, "sat": 1}
    },
    "primariesBars": {
        "top": {"temp": 0, "tint": 0, "cont": 1, "pivot": 0.435, "md": 0},
        "bot": {"colBoost": 0, "shad": 0, "hiLight": 0, "sat": 50, "hue": 50, "lMix": 100},
        "lift": {"y": 0, "r": 0, "g": 0, "b": 0},
        "gamma": {"y": 0, "r": 0, "g": 0, "b": 0},
        "gain": {"y": 1, "r": 1, "g": 1, "b": 1},
        "offset": {"r": 25, "g": 25, "b": 25}
    }
}

def load_app_settings():
    settings = dict(DEFAULT_SETTINGS)
    if os.path.exists(SETTINGS_PATH):
        try:
            with open(SETTINGS_PATH, "r", encoding="utf-8") as f:
                saved = json.load(f)
                if isinstance(saved, dict):
                    settings.update(saved)
        except Exception:
            pass
    return settings

def save_app_settings(new_data):
    try:
        current = load_app_settings()
        current.update(new_data)
        with open(SETTINGS_PATH, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=2, ensure_ascii=False)
        return True
    except Exception:
        return False

def get_ffmpeg_bin():
    local_dir = APP_DIR
    candidates = [
        os.path.join(local_dir, "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"),
        os.path.join(local_dir, "bin", "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"),
        "/usr/local/LRTimelapse/ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "ffmpeg"
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
        which_path = shutil.which(c)
        if which_path:
            return which_path
    return "ffmpeg"

def get_best_encoder(ffmpeg_bin, codec_type="h264"):
    c = (codec_type or "h264").lower()
    if sys.platform == "darwin":
        if "prores" in c:
            return "prores_videotoolbox"
        elif c in ["hevc", "h265"]:
            return "hevc_videotoolbox"
        elif c in ["vp9"]:
            return "libvpx-vp9"
        return "h264_videotoolbox"
    elif sys.platform == "win32":
        try:
            res = subprocess.run([ffmpeg_bin, "-encoders"], capture_output=True, text=True, errors="ignore")
            out = res.stdout or ""
            if "prores" in c:
                return "prores_ks"
            elif c in ["hevc", "h265"]:
                if "hevc_nvenc" in out: return "hevc_nvenc"
                elif "hevc_qsv" in out: return "hevc_qsv"
                elif "hevc_amf" in out: return "hevc_amf"
                return "libx265"
            elif c in ["vp9"]:
                return "libvpx-vp9"
            else:
                if "h264_nvenc" in out: return "h264_nvenc"
                elif "h264_qsv" in out: return "h264_qsv"
                elif "h264_amf" in out: return "h264_amf"
                return "libx264"
        except:
            pass
        return "libx264"
    if "prores" in c:
        return "prores_ks"
    elif c in ["hevc", "h265"]:
        return "libx265"
    return "libx264"

FFMPEG_BIN = get_ffmpeg_bin()

SUPPORTED_EXT = {
    ".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".m2ts", ".webm",
    ".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp", ".tif", ".tiff",
    ".nef", ".nrw", ".arw", ".cr2", ".cr3", ".dng"
}

STATE = {
    "clips": [],
    "output_dir": get_default_output_dir(),
    "is_exporting": False,
    "is_paused": False,
    "cancel_requested": False,
    "progress": {
        "current_idx": 0,
        "total": 0,
        "current_name": "",
        "completed_paths": [],
        "percent": 0.0,
        "speed": "0x",
        "remaining_str": "",
        "eta_str": "",
        "status": "Ready"
    }
}

active_processes = set()
proc_lock = threading.Lock()

def add_active_proc(p):
    with proc_lock:
        active_processes.add(p)

def remove_active_proc(p):
    with proc_lock:
        active_processes.discard(p)

def extract_nikon_metadata(filepath):
    """
    Extract embedded in-camera Nikon metadata (Picture Control, Model, Lens, WB)
    directly from MP4/MOV header atoms (NCDT / NCTG maker notes).
    """
    meta = {
        "is_nikon": False,
        "camera_model": "",
        "lens": "",
        "picture_control": "",
        "white_balance": "",
        "firmware": ""
    }
    try:
        with open(filepath, "rb") as f:
            data = f.read(65536)

        if b"NIKON" in data:
            meta["is_nikon"] = True
            meta["make"] = "Nikon"

        # Regex detect Nikon Z models (Z8, Z9, Z6 III, Zf, ZR, Zfc, Z7 II, Z6 II, Z5, etc.)
        z_match = re.search(rb"NIKON\s+(Z\s*[0-9a-zA-Z_]+(?:\s*(?:III|II|IV|f|fc|R))?)", data, re.IGNORECASE)
        if z_match:
            raw_model = z_match.group(1).decode("latin1", errors="ignore").replace("_", " ").strip()
            if any(k in raw_model for k in ["6 3", "6_3", "6 III", "6III"]):
                meta["camera_model"] = "Nikon Z6 III"
            elif "8" in raw_model:
                meta["camera_model"] = "Nikon Z8"
            elif "9" in raw_model:
                meta["camera_model"] = "Nikon Z9"
            elif "fc" in raw_model.lower():
                meta["camera_model"] = "Nikon Zfc"
            elif "f" in raw_model.lower():
                meta["camera_model"] = "Nikon Zf"
            elif "r" in raw_model.lower():
                meta["camera_model"] = "Nikon ZR"
            elif "7" in raw_model:
                meta["camera_model"] = "Nikon Z7 II" if "ii" in raw_model.lower() else "Nikon Z7"
            elif "6" in raw_model:
                meta["camera_model"] = "Nikon Z6 II" if "ii" in raw_model.lower() else "Nikon Z6"
            elif "50" in raw_model:
                meta["camera_model"] = "Nikon Z50"
            elif "30" in raw_model:
                meta["camera_model"] = "Nikon Z30"
            elif "5" in raw_model:
                meta["camera_model"] = "Nikon Z5"
            else:
                meta["camera_model"] = f"Nikon {raw_model}"
        elif b"NIKON Z 8" in data:
            meta["camera_model"] = "Nikon Z8"
        elif b"NIKON Z 6" in data:
            meta["camera_model"] = "Nikon Z6 III" if (b"III" in data or b"6_3" in data) else "Nikon Z6"
        elif b"NIKON Z f" in data:
            meta["camera_model"] = "Nikon Zf"
        elif b"NIKON" in data:
            meta["camera_model"] = "Nikon Z Series"

        # Firmware
        fw_idx = data.find(b"Ver.")
        if fw_idx != -1:
            meta["firmware"] = data[fw_idx:fw_idx+12].decode("latin1", errors="ignore").split("\x00")[0].strip()

        # Lens
        lens_idx = data.find(b"NIKKOR Z")
        if lens_idx != -1:
            meta["lens"] = data[lens_idx:lens_idx+40].decode("latin1", errors="ignore").split("\x00")[0].strip()

        # In-Camera Picture Control (Tag 0x0023 / 0310)
        pc_idx = data.find(b"03100310")
        if pc_idx != -1:
            pc_name = data[pc_idx+8:pc_idx+28].decode("latin1", errors="ignore").strip("\x00").strip()
            meta["picture_control"] = pc_name
        else:
            # Fallback scan for common names
            for pc in [b"PORTRAIT", b"STANDARD", b"NEUTRAL", b"VIVID", b"FLAT", b"MONOCHROME", b"DREAM", b"MORNING", b"POP"]:
                if pc in data:
                    meta["picture_control"] = pc.decode("latin1")
                    break

        # White Balance
        for wb in [b"SUNNY", b"AUTO", b"CLOUDY", b"SHADE", b"INCANDESCENT", b"FLUORESCENT", b"FLASH", b"K_TEMP"]:
            if wb in data:
                meta["white_balance"] = wb.decode("latin1")
                break
    except Exception:
        pass
    return meta

def get_media_info(filepath):
    info = {"fps": "25.000", "duration": 0.0, "width": 1920, "height": 1080}
    try:
        cmd = [FFMPEG_BIN, "-i", filepath]
        res = subprocess.run(cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True, errors="ignore")
        text = res.stderr
        dur_m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", text)
        if dur_m:
            h, m, s = dur_m.groups()
            info["duration"] = int(h) * 3600 + int(m) * 60 + float(s)
        res_m = re.search(r",\s*(\d{3,4})x(\d{3,4})", text)
        if res_m:
            info["width"], info["height"] = int(res_m.group(1)), int(res_m.group(2))
        fps_m = re.search(r"(\d+(?:\.\d+)?)\s*fps", text)
        if fps_m:
            f = float(fps_m.group(1))
            info["fps"] = f"{f:.0f}.000" if f.is_integer() else f"{f:.3f}"
    except Exception:
        pass
    return info

def natural_sort_key(s):
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', os.path.basename(s))]

def scan_files(paths):
    found = []
    for p in paths:
        obj = Path(p.strip())
        if not obj.exists(): continue
        if obj.is_dir():
            for root, dirs, files in os.walk(p):
                # Never descend into exported output folders or hidden directories
                dirs[:] = [d for d in dirs if not d.startswith("_vertical") and not d.startswith(".")]
                for f in files:
                    stem_low = Path(f).stem.lower()
                    if not f.startswith("._") and not stem_low.endswith("_vertical") and not re.search(r"_vertical_\d+$", stem_low) and Path(f).suffix.lower() in SUPPORTED_EXT:
                        found.append(os.path.join(root, f))
        elif obj.is_file():
            if not obj.name.startswith("._") and obj.suffix.lower() in SUPPORTED_EXT:
                found.append(str(obj.resolve()))

    # Sort files naturally by filename (STD_0001 -> STD_0002) matching shooting timeline!
    found.sort(key=natural_sort_key)

    existing = {it["path"] for it in STATE["clips"]}
    new_clips = []
    for f in found:
        if f not in existing:
            n_meta = extract_nikon_metadata(f)
            new_clips.append({
                "path": f,
                "name": os.path.basename(f),
                "size": os.path.getsize(f),
                "size_fmt": f"{os.path.getsize(f) / (1024*1024):.1f} MB",
                "mtime": os.path.getmtime(f),
                "fps": "25.000",
                "nikon_meta": n_meta
            })
    STATE["clips"].extend(new_clips)
    return len(new_clips)

class StudioHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

    def end_headers(self):
        if not self.path.startswith("/api/video") and not self.path.startswith("/api/thumb"):
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        super().end_headers()

    def do_HEAD(self):
        url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(url.query)
        if url.path == "/api/video":
            fpath = qs.get("path", [""])[0]
            if fpath and os.path.exists(fpath):
                file_size = os.path.getsize(fpath)
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(file_size))
                self.send_header("Accept-Ranges", "bytes")
                self.end_headers()
                return
        super().do_HEAD()

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(url.query)

        if url.path == "/api/clips":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(STATE["clips"]).encode())
            return

        elif url.path == "/api/get-output-folder":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"output_dir": STATE.get("output_dir", "")}).encode())
            return

        elif url.path == "/api/status":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            status_data = dict(STATE["progress"])
            status_data["is_exporting"] = STATE.get("is_exporting", False)
            status_data["is_paused"] = STATE.get("is_paused", False)
            status_data["version"] = ZCUT_VERSION
            self.wfile.write(json.dumps(status_data).encode())
            return

        elif url.path == "/api/check-update":
            res = check_for_update()
            payload_bytes = json.dumps(res).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload_bytes)))
            self.end_headers()
            self.wfile.write(payload_bytes)
            return

        elif url.path == "/api/list-dir":
            requested = qs.get("path", [""])[0].strip()
            dir_path = requested
            if not dir_path or not os.path.exists(dir_path) or not os.path.isdir(dir_path):
                desktop = get_user_desktop()
                if os.path.exists(desktop):
                    dir_path = desktop
                elif sys.platform == "win32" and os.path.exists("C:\\"):
                    dir_path = "C:\\"
                else:
                    dir_path = os.path.expanduser("~")

            entries = []
            try:
                for entry in sorted(os.scandir(dir_path), key=lambda e: (not e.is_dir(), e.name.lower())):
                    if entry.name.startswith(".") or entry.name.startswith("$"):
                        continue
                    is_d = False
                    try:
                        is_d = entry.is_dir()
                    except Exception:
                        continue
                    video_count = 0
                    if is_d:
                        try:
                            video_count = sum(1 for f in os.scandir(entry.path) if not f.name.startswith("._") and Path(f.name).suffix.lower() in SUPPORTED_EXT)
                        except Exception:
                            pass
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": is_d,
                        "video_count": video_count
                    })
            except Exception:
                pass

            parent_path = str(Path(dir_path).parent)
            drives = []
            if sys.platform == "win32":
                import string
                for letter in string.ascii_uppercase:
                    d = f"{letter}:\\"
                    if os.path.exists(d):
                        drives.append(d)

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({
                "current": dir_path,
                "parent": parent_path,
                "drives": drives,
                "entries": entries
            }).encode())
            return

        elif url.path == "/api/thumb":
            fpath = qs.get("path", [""])[0]
            hi_res = qs.get("hi", ["0"])[0] == "1"
            if not fpath or not os.path.exists(fpath):
                self.send_error(404, "File not found")
                return
            thumb_cache_dir = THUMB_CACHE_DIR
            os.makedirs(thumb_cache_dir, exist_ok=True)
            prefix = "hi_" if hi_res else ""
            scale_vf = "scale=640:-2" if hi_res else "scale=240:-2"
            qv = "3" if hi_res else "5"
            t_path = os.path.join(thumb_cache_dir, f"{prefix}{os.path.basename(fpath)}.jpg")
            if not os.path.exists(t_path):
                ext = Path(fpath).suffix.lower()
                is_img = ext in {".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".tif", ".tiff", ".nef", ".nrw", ".arw", ".cr2", ".cr3", ".dng"}
                if is_img:
                    subprocess.run([
                        FFMPEG_BIN, "-i", fpath,
                        "-vframes", "1", "-vf", scale_vf, "-q:v", qv,
                        "-y", t_path
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    subprocess.run([
                        FFMPEG_BIN, "-ss", "00:00:00.5", "-i", fpath,
                        "-vframes", "1", "-vf", scale_vf, "-q:v", qv,
                        "-y", t_path
                    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    if not os.path.exists(t_path):
                        subprocess.run([
                            FFMPEG_BIN, "-i", fpath,
                            "-vframes", "1", "-vf", scale_vf, "-q:v", qv,
                            "-y", t_path
                        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            if os.path.exists(t_path):
                self.send_response(200)
                self.send_header("Content-Type", "image/jpeg")
                self.send_header("Cache-Control", "public, max-age=3600")
                self.end_headers()
                with open(t_path, "rb") as f:
                    self.wfile.write(f.read())
            else:
                self.send_error(500, "Could not generate thumbnail")
            return

        elif url.path == "/api/video":
            fpath = qs.get("path", [""])[0]
            if not fpath or not os.path.exists(fpath):
                self.send_error(404)
                return
            self.serve_video_file(fpath)
            return

        elif url.path == "/api/settings":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(load_app_settings()).encode())
            return

        super().do_GET()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode()
        data = json.loads(post_body) if post_body else {}

        if url.path == "/api/settings":
            success = save_app_settings(data)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": success, "settings": load_app_settings()}).encode())
            return

        elif url.path == "/api/quit":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "status": "quitting"}).encode())
            threading.Thread(target=lambda: (time.sleep(0.3), os._exit(0))).start()
            return

        elif url.path == "/api/clear" or url.path == "/api/clear_on_exit":
            with proc_lock:
                STATE["clips"] = []
                STATE["progress"] = {
                    "current_idx": 0, "total": 0, "current_name": "", "percent": 0.0,
                    "speed": "0.0x", "remaining_str": "00m 00s", "status": "Ready",
                    "eta_str": "--:--", "completed_paths": []
                }
            purge_system_and_process_ram()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "total": 0}).encode())
            return

        elif url.path == "/api/browse-folder":
            global _LAST_PICKER_CLOSE_TS
            now_ts = time.time()
            if (now_ts - _LAST_PICKER_CLOSE_TS < 2.5) or (not _PICKER_LOCK.acquire(blocking=False)):
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "debounced": True}).encode())
                return
            try:
                _LAST_PICKER_CLOSE_TS = now_ts

                chosen = ""
                unsupported = sys.platform not in ("darwin", "win32")
                default_dir = get_user_desktop()
                if sys.platform == "darwin":
                    osa_script = (
                        'try\n'
                        f'    set defLoc to POSIX file "{default_dir}"\n'
                        '    tell application "System Events" to activate\n'
                        '    set sel to choose folder with prompt "Select Video Folder / เลือกโฟลเดอร์วิดีโอ" default location (defLoc as alias)\n'
                        '    return POSIX path of sel\n'
                        'on error\n'
                        '    return ""\n'
                        'end try'
                    )
                    try:
                        res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
                        chosen = res.stdout.strip()
                    except Exception:
                        pass
                elif sys.platform == "win32":
                    ps_script = (
                        'Add-Type -AssemblyName System.Windows.Forms; '
                        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
                        '$d.ShowNewFolderButton = $true; '
                        '$d.Description = "Select Video Folder / เลือกโฟลเดอร์วิดีโอ"; '
                        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }'
                    )
                    try:
                        res = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-Command", ps_script], capture_output=True, text=True)
                        chosen = res.stdout.strip()
                    except Exception:
                        pass

                added = 0
                if chosen and os.path.exists(chosen):
                    added = scan_files([chosen])
                _LAST_PICKER_CLOSE_TS = time.time()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": bool(chosen), "added": added, "path": chosen, "total": len(STATE["clips"]), "unsupported": unsupported}).encode())
                return
            finally:
                _PICKER_LOCK.release()

        elif url.path == "/api/browse-files":
            now_ts = time.time()
            last_ts = getattr(StudioHandler, "_last_browse_files_ts", 0.0)
            if now_ts - last_ts < 1.0:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "debounced": True}).encode())
                return
            StudioHandler._last_browse_files_ts = now_ts

            paths = []
            unsupported = sys.platform not in ("darwin", "win32")
            default_dir = get_user_desktop()
            if sys.platform == "darwin":
                osa_script = (
                    'try\n'
                    f'    set defLoc to POSIX file "{default_dir}"\n'
                    '    tell application "System Events" to activate\n'
                    '    set theFiles to choose file with prompt "Select Media Files / เลือกไฟล์วิดีโอหรือรูปภาพ" default location (defLoc as alias) with multiple selections allowed\n'
                    '    set res to ""\n'
                    '    repeat with f in theFiles\n'
                    '        set res to res & (POSIX path of f) & "\\n"\n'
                    '    end repeat\n'
                    '    return res\n'
                    'on error\n'
                    '    return ""\n'
                    'end try'
                )
                try:
                    res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
                    paths = [p.strip() for p in res.stdout.strip().splitlines() if p.strip()]
                except Exception:
                    pass
            elif sys.platform == "win32":
                ps_script = (
                    'Add-Type -AssemblyName System.Windows.Forms; '
                    '$d = New-Object System.Windows.Forms.OpenFileDialog; '
                    '$d.Title = "Select Media Files / เลือกไฟล์วิดีโอหรือรูปภาพ"; '
                    '$d.Filter = "Media Files (*.mp4;*.mov;*.mkv;*.m4v;*.jpg;*.png)|*.mp4;*.mov;*.mkv;*.m4v;*.jpg;*.png;*.jpeg;*.webp;*.nef;*.cr3;*.arw;*.dng|All Files (*.*)|*.*"; '
                    '$d.Multiselect = $true; '
                    'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { '
                    '    $d.FileNames | ForEach-Object { Write-Output $_ } '
                    '}'
                )
                try:
                    res = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-Command", ps_script], capture_output=True, text=True)
                    paths = [p.strip() for p in res.stdout.strip().splitlines() if p.strip()]
                except Exception:
                    pass

            added = 0
            if paths:
                added = scan_files(paths)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": bool(paths), "added": added, "total": len(STATE["clips"]), "unsupported": unsupported}).encode())
            return

        elif url.path == "/api/load-path":
            target_path = data.get("path", "").strip()
            added = 0
            if target_path and os.path.exists(target_path):
                added = scan_files([target_path])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "added": added, "path": target_path, "total": len(STATE["clips"])}).encode())
            return

        elif url.path == "/api/scan":
            paths = data.get("paths", [])
            added = scan_files(paths)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"added": added, "total": len(STATE["clips"])}).encode())
            return

        elif url.path == "/api/export":
            if not STATE["is_exporting"]:
                if not STATE["clips"] and data.get("paths"):
                    scan_files(data.get("paths"))
                if STATE["clips"]:
                    threading.Thread(target=run_batch_export, args=(data,), daemon=True).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode())
            return

        elif url.path == "/api/set-output-folder":
            chosen = data.get("output_dir", "").strip()
            if not chosen:
                now_ts = time.time()
                if (now_ts - _LAST_PICKER_CLOSE_TS < 2.5) or (not _PICKER_LOCK.acquire(blocking=False)):
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "debounced": True, "output_dir": STATE.get("output_dir", "")}).encode())
                    return
                try:
                    _LAST_PICKER_CLOSE_TS = now_ts
                    cur_loc = STATE.get("output_dir") or get_default_output_dir()
                    if not os.path.exists(cur_loc):
                        cur_loc = get_user_desktop()
                    if sys.platform == "darwin":
                        osa_script = (
                            'try\n'
                            f'    set defLoc to POSIX file "{cur_loc}"\n'
                            '    tell application "System Events" to activate\n'
                            '    set sel to choose folder with prompt "Select or Create Destination Folder / เลือกหรือสร้างโฟลเดอร์ปลายทาง" default location (defLoc as alias)\n'
                            '    return POSIX path of sel\n'
                            'on error\n'
                            '    return ""\n'
                            'end try'
                        )
                        try:
                            res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
                            chosen = res.stdout.strip()
                        except Exception:
                            pass
                    elif sys.platform == "win32":
                        ps_script = (
                            'Add-Type -AssemblyName System.Windows.Forms; '
                            '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
                            '$d.ShowNewFolderButton = $true; '
                            '$d.Description = "Select or Create Destination Folder"; '
                            'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }'
                        )
                        try:
                            res = subprocess.run(["powershell.exe", "-NoProfile", "-STA", "-Command", ps_script], capture_output=True, text=True)
                            chosen = res.stdout.strip()
                        except Exception:
                            pass
                    _LAST_PICKER_CLOSE_TS = time.time()
                finally:
                    _PICKER_LOCK.release()

            if chosen:
                os.makedirs(chosen, exist_ok=True)
                STATE["output_dir"] = chosen
                save_app_settings({"outputPath": chosen})

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": bool(chosen), "output_dir": STATE.get("output_dir", "")}).encode())
            return

        elif url.path == "/api/open-folder":
            now_ts = time.time()
            last_ts = STATE.get("_last_open_folder_ts", 0.0)
            if now_ts - last_ts < 1.0:
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "debounced": True}).encode())
                return
            STATE["_last_open_folder_ts"] = now_ts
            target_dir = STATE.get("output_dir", get_default_output_dir())
            os.makedirs(target_dir, exist_ok=True)
            if sys.platform == "win32":
                try:
                    os.startfile(target_dir)
                except Exception:
                    subprocess.run(["explorer.exe", target_dir])
            else:
                subprocess.run(["open", target_dir])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "output_dir": target_dir}).encode())
            return
            return

        elif url.path == "/api/clear-cache":
            freed = 0
            thumb_cache_dir = THUMB_CACHE_DIR
            if os.path.exists(thumb_cache_dir):
                for f in os.scandir(thumb_cache_dir):
                    try:
                        freed += f.stat().st_size
                        os.remove(f.path)
                    except:
                        pass
            purge_system_and_process_ram()
            freed_mb = f"{freed / (1024*1024):.1f} MB"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "freed": freed_mb}).encode())
            return

        elif url.path == "/api/analyze-blur":
            paths = data.get("paths") or []
            max_sec = float(data.get("max_seconds") or 5.0)
            sensitivity = str(data.get("sensitivity") or "balanced")
            result = batch_analyze_blurry_intros(paths, max_seconds=max_sec, sensitivity=sensitivity)
            payload_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload_bytes)))
            self.end_headers()
            self.wfile.write(payload_bytes)
            return

        elif url.path == "/api/analyze-whole-blur":
            paths = data.get("paths") or []
            sensitivity = str(data.get("sensitivity") or "balanced")
            result = batch_analyze_whole_clips(paths, sensitivity=sensitivity)
            payload_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload_bytes)))
            self.end_headers()
            self.wfile.write(payload_bytes)
            return

        elif url.path == "/api/auto-color":
            target_path = str(data.get("path") or "").strip()
            result = analyze_auto_color(target_path)
            payload_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload_bytes)))
            self.end_headers()
            self.wfile.write(payload_bytes)
            return

        elif url.path == "/api/apply-update":
            zip_url = str(data.get("update_zip_url") or "").strip()
            result = apply_remote_update(zip_url)
            payload_bytes = json.dumps(result).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload_bytes)))
            self.end_headers()
            self.wfile.write(payload_bytes)
            return

        elif url.path == "/api/pause":
            STATE["is_paused"] = not STATE.get("is_paused", False)
            st = "Paused" if STATE["is_paused"] else "Rendering..."
            STATE["progress"]["status"] = st
            with proc_lock:
                for proc in list(active_processes):
                    try:
                        if STATE["is_paused"]:
                            if sys.platform != "win32":
                                os.kill(proc.pid, signal.SIGSTOP)
                        else:
                            if sys.platform != "win32":
                                os.kill(proc.pid, signal.SIGCONT)
                    except Exception:
                        pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "is_paused": STATE["is_paused"], "status": st}).encode())
            return

        elif url.path == "/api/cancel":
            STATE["cancel_requested"] = True
            STATE["is_paused"] = False
            STATE["is_exporting"] = False
            STATE["progress"]["status"] = "Stopped"
            with proc_lock:
                for proc in list(active_processes):
                    try:
                        if sys.platform != "win32":
                            os.kill(proc.pid, signal.SIGCONT)
                        proc.terminate()
                    except Exception:
                        pass
                active_processes.clear()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "status": "Stopped"}).encode())
            return

        self.send_error(404)

    def serve_video_file(self, filepath):
        file_size = os.path.getsize(filepath)
        ext = Path(filepath).suffix.lower()
        if ext in {".jpg", ".jpeg"}:
            ctype = "image/jpeg"
        elif ext == ".png":
            ctype = "image/png"
        elif ext == ".webp":
            ctype = "image/webp"
        elif ext == ".mov":
            ctype = "video/quicktime"
        else:
            ctype = "video/mp4"

        range_header = self.headers.get("Range", None)
        if not range_header:
            self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(file_size))
            self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            with open(filepath, "rb") as f:
                shutil.copyfileobj(f, self.wfile)
            return

        # Partial Content
        byte_range = range_header.strip().split("=")[-1]
        start_str, end_str = byte_range.split("-")
        start = int(start_str) if start_str else 0
        end = int(end_str) if end_str else file_size - 1
        length = end - start + 1

        self.send_response(206)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()

        with open(filepath, "rb") as f:
            f.seek(start)
            bytes_left = length
            while bytes_left > 0:
                chunk = f.read(min(bytes_left, 65536))
                if not chunk: break
                self.wfile.write(chunk)
                bytes_left -= len(chunk)


import tempfile
import urllib.request
import zipfile

ZCUT_VERSION = "2.1.6"
UPDATE_MANIFEST_URL = "https://memories-stack.github.io/turbocompress-studio/version.json"
DOWNLOAD_PAGE_URL = "https://memories-stack.github.io/turbocompress-studio/"
SERVER_INSTANCE = None
import colorsys

_BAKED_LUT_CACHE = {"hash": None, "path": None}

# Exact Hue Centers (in degrees 0-360) and Half-Widths for DaVinci 7-Vector ColorSlice
COLORSLICE_HUE_WINDOWS = {
    "red":     (0.0,   26.0),
    "skin":    (22.0,  24.0),  # Human skin tone I-Line (~8° to 46° orange-peach)
    "yellow":  (58.0,  26.0),
    "green":   (112.0, 42.0),  # Foliage & grass (70° to 154°)
    "cyan":    (180.0, 34.0),
    "blue":    (228.0, 38.0),  # Sky & blue apparel (190° to 266°)
    "magenta": (305.0, 36.0)
}

def _hue_diff_deg(h1, h2):
    d = (h1 - h2 + 180.0) % 360.0 - 180.0
    return d

def bake_davinci_grade_lut(cs, pb, skin_hue=0.0, skin_bright=0.0):
    """
    Bakes DaVinci ColorSlice (7-Vector Selective HSL) + Primaries Color Bars (True Non-Linear Lift/Gamma/Gain/Offset)
    + Selective Skin Tone & Radiance into a 17x17x17 .cube 3D LUT in ~5ms.
    Neutral greys/whites/blacks (roads, shoes, shadows) are 100% protected from color casts.
    """
    cs_active = False
    if isinstance(cs, dict):
        m = cs.get("master") or {}
        if (abs(float(m.get("den", 0))) > 0.005 or abs(float(m.get("denDepth", 0))) > 0.005 or
            abs(float(m.get("sat", 1)) - 1.0) > 0.005 or abs(float(m.get("satBal", 0))) > 0.005 or
            abs(float(m.get("satDepth", 0))) > 0.005 or abs(float(m.get("hue", 0))) > 0.005):
            cs_active = True
        for k in COLORSLICE_HUE_WINDOWS:
            sl = cs.get(k) or {}
            if (abs(float(sl.get("center", 0))) > 0.005 or abs(float(sl.get("hue", 0))) > 0.005 or
                abs(float(sl.get("den", 0))) > 0.005 or abs(float(sl.get("sat", 1)) - 1.0) > 0.005):
                cs_active = True
                break

    pb_active = False
    if isinstance(pb, dict):
        t = pb.get("top") or {}
        b = pb.get("bot") or {}
        lf = pb.get("lift") or {}
        gm = pb.get("gamma") or {}
        gn = pb.get("gain") or {}
        of = pb.get("offset") or {}
        if (abs(float(t.get("temp", 0))) > 0.05 or abs(float(t.get("tint", 0))) > 0.05 or
            abs(float(t.get("cont", 1)) - 1.0) > 0.003 or abs(float(t.get("pivot", 0.435)) - 0.435) > 0.005 or
            abs(float(t.get("md", 0))) > 0.05 or abs(float(b.get("colBoost", 0))) > 0.05 or
            abs(float(b.get("shad", 0))) > 0.05 or abs(float(b.get("hiLight", 0))) > 0.05 or
            abs(float(b.get("sat", 50)) - 50.0) > 0.1 or abs(float(b.get("hue", 50)) - 50.0) > 0.1 or
            abs(float(lf.get("y", 0))) > 0.003 or abs(float(lf.get("r", 0))) > 0.003 or abs(float(lf.get("g", 0))) > 0.003 or abs(float(lf.get("b", 0))) > 0.003 or
            abs(float(gm.get("y", 0))) > 0.003 or abs(float(gm.get("r", 0))) > 0.003 or abs(float(gm.get("g", 0))) > 0.003 or abs(float(gm.get("b", 0))) > 0.003 or
            abs(float(gn.get("y", 1)) - 1.0) > 0.003 or abs(float(gn.get("r", 1)) - 1.0) > 0.003 or abs(float(gn.get("g", 1)) - 1.0) > 0.003 or abs(float(gn.get("b", 1)) - 1.0) > 0.003 or
            abs(float(of.get("r", 25)) - 25.0) > 0.05 or abs(float(of.get("g", 25)) - 25.0) > 0.05 or abs(float(of.get("b", 25)) - 25.0) > 0.05):
            pb_active = True

    skin_slider_active = (abs(float(skin_hue)) > 0.2 or abs(float(skin_bright)) > 0.2)

    if not cs_active and not pb_active and not skin_slider_active:
        return None

    state_key = json.dumps({
        "cs": cs if cs_active else None,
        "pb": pb if pb_active else None,
        "sh": round(float(skin_hue), 2),
        "sb": round(float(skin_bright), 2)
    }, sort_keys=True)
    h_val = hashlib.md5(state_key.encode("utf-8")).hexdigest()[:12]
    if _BAKED_LUT_CACHE["hash"] == h_val and _BAKED_LUT_CACHE["path"] and os.path.exists(_BAKED_LUT_CACHE["path"]):
        return _BAKED_LUT_CACHE["path"]

    # Pre-extract Primaries Bars parameters
    if pb_active and isinstance(pb, dict):
        t = pb.get("top") or {}
        b = pb.get("bot") or {}
        lf = pb.get("lift") or {}
        gm = pb.get("gamma") or {}
        gn = pb.get("gain") or {}
        of = pb.get("offset") or {}
        pb_temp = float(t.get("temp", 0.0)) / 100.0
        pb_tint = float(t.get("tint", 0.0)) / 100.0
        pb_cont = float(t.get("cont", 1.0))
        pb_pivot = max(0.05, min(0.95, float(t.get("pivot", 0.435))))
        pb_md = float(t.get("md", 0.0)) / 100.0
        pb_colboost = float(b.get("colBoost", 0.0)) / 100.0
        pb_shad = float(b.get("shad", 0.0)) / 100.0
        pb_hilight = float(b.get("hiLight", 0.0)) / 100.0
        pb_sat = float(b.get("sat", 50.0)) / 50.0
        pb_hue_deg = ((float(b.get("hue", 50.0)) - 50.0) / 50.0) * 36.0

        lift_rgb = [
            float(lf.get("y", 0.0)) + float(lf.get("r", 0.0)) * 0.85 + (float(of.get("r", 25.0)) - 25.0) * 0.014,
            float(lf.get("y", 0.0)) + float(lf.get("g", 0.0)) * 0.85 + (float(of.get("g", 25.0)) - 25.0) * 0.014,
            float(lf.get("y", 0.0)) + float(lf.get("b", 0.0)) * 0.85 + (float(of.get("b", 25.0)) - 25.0) * 0.014
        ]
        gain_rgb = [
            float(gn.get("y", 1.0)) * float(gn.get("r", 1.0)) * (1.0 + pb_temp * 0.22 + pb_tint * 0.10),
            float(gn.get("y", 1.0)) * float(gn.get("g", 1.0)) * (1.0 - pb_tint * 0.14),
            float(gn.get("y", 1.0)) * float(gn.get("b", 1.0)) * (1.0 - pb_temp * 0.22 + pb_tint * 0.10)
        ]
        gamma_rgb = [
            max(0.20, min(4.5, 1.0 / max(0.18, 1.0 + (float(gm.get("y", 0.0)) + float(gm.get("r", 0.0))) * 1.45))),
            max(0.20, min(4.5, 1.0 / max(0.18, 1.0 + (float(gm.get("y", 0.0)) + float(gm.get("g", 0.0))) * 1.45))),
            max(0.20, min(4.5, 1.0 / max(0.18, 1.0 + (float(gm.get("y", 0.0)) + float(gm.get("b", 0.0))) * 1.45)))
        ]

    # Pre-extract ColorSlice parameters (merging dedicated Skin Tone & Radiance sliders into the 'skin' slice!)
    active_slices = []
    g_den = 0.0
    g_sat = 1.0
    g_hue_deg = 0.0
    if cs_active and isinstance(cs, dict):
        m = cs.get("master") or {}
        g_den = float(m.get("den", 0.0)) + float(m.get("denDepth", 0.0)) * 0.35
        g_sat = float(m.get("sat", 1.0)) + float(m.get("satBal", 0.0)) * 0.25 + float(m.get("satDepth", 0.0)) * 0.20
        g_hue_deg = float(m.get("hue", 0.0)) * 30.0

    for k, (base_c, half_w) in COLORSLICE_HUE_WINDOWS.items():
        sl = (cs.get(k) if (cs_active and isinstance(cs, dict)) else None) or {}
        c_shift = float(sl.get("center", 0.0)) * 14.0
        raw_hue = float(sl.get("hue", 0.0))
        # For skin (22°), dragging Hue right (+) toward Red/Magenta shifts angle toward 8° Rosy Pink
        h_shift = (-raw_hue * 18.0) if k == "skin" else (raw_hue * 24.0)
        den = float(sl.get("den", 0.0))
        sat = float(sl.get("sat", 1.0))

        # Merge the dedicated Skin Tone & Radiance sliders directly into the selective 'skin' vector!
        if k == "skin" and skin_slider_active:
            # Positive skin_hue = Rosy Pink (shifts skin hue from ~22° orange-yellow counter-clockwise toward ~12° rose-red)
            h_shift -= (float(skin_hue) / 50.0) * 14.0
            # Positive skin_bright = Lifts skin luminance (negative subtractive density!)
            den -= (float(skin_bright) / 50.0) * 0.38
            sat *= (1.0 + abs(float(skin_hue)) / 50.0 * 0.12)

        if abs(c_shift) > 0.05 or abs(h_shift) > 0.05 or abs(den) > 0.003 or abs(sat - 1.0) > 0.003:
            active_slices.append((k, (base_c + c_shift) % 360.0, half_w, h_shift, den, sat))

    lut_path = os.path.join(tempfile.gettempdir(), f"zcut_grade_{h_val}.cube")
    lines = ["TITLE \"ZCut_DaVinci_Selective_3DLUT\"", "LUT_3D_SIZE 17", "DOMAIN_MIN 0.0 0.0 0.0", "DOMAIN_MAX 1.0 1.0 1.0"]
    size = 17
    inv = 1.0 / (size - 1)
    import math

    for bi in range(size):
        b_in = bi * inv
        for gi in range(size):
            g_in = gi * inv
            for ri in range(size):
                r, g, b = ri * inv, g_in, b_in

                # STAGE 1: True Non-Linear DaVinci Primaries Color Bars (Lift / Gamma / Gain / Offset / Pivot / Shad / HiLight / ColBoost)
                if pb_active:
                    rgb = [r, g, b]
                    for ch_i in range(3):
                        v = rgb[ch_i]
                        # Lift (affects shadows, anchored at 1.0) & Gain (scales from 0.0)
                        v = v * gain_rgb[ch_i] + lift_rgb[ch_i] * (1.0 - v)
                        v = max(0.0, min(1.0, v))
                        # True Gamma power curve (0.0 and 1.0 remain 100% anchored!)
                        if v > 0.0:
                            v = v ** gamma_rgb[ch_i]
                        # Shadow & Highlight recovery
                        if abs(pb_shad) > 0.002:
                            v += pb_shad * 0.28 * ((1.0 - v) ** 2) * (v ** 0.5)
                        if abs(pb_hilight) > 0.002:
                            v += pb_hilight * 0.28 * (v ** 2) * ((1.0 - v) ** 0.5)
                        # Midtone Detail (MD) contrast curve
                        if abs(pb_md) > 0.002:
                            v += pb_md * 0.22 * math.sin((v - 0.5) * math.pi) * (4.0 * v * (1.0 - v))
                        # Contrast around Pivot
                        if abs(pb_cont - 1.0) > 0.002:
                            v = pb_pivot + (v - pb_pivot) * pb_cont
                        rgb[ch_i] = max(0.0, min(1.0, v))
                    r, g, b = rgb[0], rgb[1], rgb[2]

                    # Primaries Saturation, Color Boost (Vibrance), and Hue
                    if abs(pb_sat - 1.0) > 0.003 or abs(pb_colboost) > 0.003 or abs(pb_hue_deg) > 0.05:
                        h, l, s = colorsys.rgb_to_hls(r, g, b)
                        if abs(pb_hue_deg) > 0.05:
                            h = (h + pb_hue_deg / 360.0) % 1.0
                        eff_s = s * pb_sat
                        if abs(pb_colboost) > 0.003:
                            # Color Boost boosts low-to-mid saturation more than already-saturated pixels
                            eff_s += pb_colboost * s * (1.0 - s) * 1.55
                        s = max(0.0, min(1.0, eff_s))
                        r, g, b = colorsys.hls_to_rgb(h, l, s)

                # STAGE 2: True Selective 7-Vector DaVinci ColorSlice (with 100% Neutral Grey/White/Black Protection)
                if cs_active or active_slices:
                    c_max = max(r, g, b)
                    c_min = min(r, g, b)
                    chroma = c_max - c_min
                    # Smooth chroma gate: neutral greys/whites/roads (chroma < 0.02) are 0% affected!
                    if chroma > 0.02:
                        sat_gate = min(1.0, max(0.0, (chroma - 0.02) / 0.14))
                        h, l, s = colorsys.rgb_to_hls(r, g, b)
                        h_deg = h * 360.0

                        tot_h_shift = g_hue_deg
                        tot_den = g_den * sat_gate
                        tot_sat_mult = g_sat

                        for (s_name, center_deg, half_w, h_sh, den_val, sat_val) in active_slices:
                            d_deg = abs(_hue_diff_deg(h_deg, center_deg))
                            if d_deg < half_w:
                                # Smooth cosine bell curve inside the slice's hue wedge
                                w_hue = math.cos((d_deg / half_w) * (math.pi * 0.5)) ** 2
                                w = w_hue * sat_gate
                                if s_name == "skin":
                                    # Extra midtone protection so deep black shadows or pure white highlights aren't shifted
                                    luma_gate = 4.0 * l * (1.0 - l)
                                    w *= max(0.25, luma_gate)
                                tot_h_shift += h_sh * w
                                tot_den += den_val * w
                                tot_sat_mult *= (1.0 + (sat_val - 1.0) * w)

                        h_new = ((h_deg + tot_h_shift) % 360.0) / 360.0
                        s_new = max(0.0, min(1.0, s * tot_sat_mult))
                        # Subtractive Film Density: positive density deepens luminance of saturated colors; negative density lifts midtone glow!
                        if tot_den >= 0:
                            l_new = l * (1.0 - tot_den * 0.52 * min(1.0, max(0.35, s_new * 1.6)))
                        else:
                            # Negative density lifts luminance smoothly with highlight roll-off protection
                            lift_amt = abs(tot_den) * 0.55
                            l_new = l + lift_amt * l * (1.0 - l) * 2.1
                        l_new = max(0.0, min(1.0, l_new))
                        r, g, b = colorsys.hls_to_rgb(h_new, l_new, s_new)

                lines.append(f"{max(0.0, min(1.0, r)):.5f} {max(0.0, min(1.0, g)):.5f} {max(0.0, min(1.0, b)):.5f}")

    with open(lut_path, "w", encoding="utf-8") as f_lut:
        f_lut.write("\n".join(lines) + "\n")

    _BAKED_LUT_CACHE["hash"] = h_val
    _BAKED_LUT_CACHE["path"] = lut_path
    return lut_path


def process_single_clip(clip_info, params, vf_base, codec, bitrate, total, start_time):
    if STATE["cancel_requested"]:
        return None
    while STATE["is_paused"] and not STATE["cancel_requested"]:
        time.sleep(0.2)
    if STATE["cancel_requested"]:
        return None

    src = clip_info["path"]
    idx = clip_info["index"]
    p = STATE["progress"]
    with proc_lock:
        p["current_idx"] = idx + 1
        p["current_name"] = clip_info["name"]

    # File Naming Pattern & Extension
    ext = (params.get("format") or "mp4").lower().strip()
    if ext == "quicktime":
        ext = "mov"
    if ext not in ["mp4", "mov", "mkv", "webm", "m4v"]:
        ext = "mp4"

    conflict = (params.get("conflict_action") or ("skip" if params.get("smart_resume", True) else "overwrite")).lower()

    naming = params.get("naming_pattern") or params.get("naming_style") or "suffix_vertical"
    custom_name = (params.get("custom_name") or params.get("file_name_pattern") or "").strip()
    stem = Path(clip_info['name']).stem

    if custom_name:
        import datetime
        now_str = datetime.datetime.now().strftime("%Y%m%d")
        has_token = any(tok in custom_name.lower() for tok in ["{source}", "{name}", "{stem}", "{index}", "{seq}", "{date}"])
        if has_token:
            base_name = custom_name
            base_name = re.sub(r"\{(?:source|name|stem)\}", stem, base_name, flags=re.IGNORECASE)
            base_name = re.sub(r"\{(?:index|seq)\}", f"{idx+1:04d}", base_name, flags=re.IGNORECASE)
            base_name = re.sub(r"\{date\}", now_str, base_name, flags=re.IGNORECASE)
        elif naming == "prefix_custom":
            sep = "" if (custom_name.endswith("_") or custom_name.endswith("-")) else "_"
            base_name = f"{custom_name}{sep}{stem}"
        elif naming == "custom":
            sep = "" if (custom_name.endswith("_") or custom_name.endswith("-")) else "_"
            base_name = f"{custom_name}{sep}{idx+1:04d}"
        else:
            base_name = custom_name
    elif naming == "prefix_reel":
        base_name = f"Reel_{idx+1:03d}_{stem}"
    elif naming == "original_same":
        base_name = f"{stem}"
    elif naming == "custom":
        base_name = f"Clip_{idx+1:04d}"
    else:
        base_name = f"{stem}_vertical"

    out_dir = params.get("output_dir") or STATE.get("output_dir") or os.path.join(os.path.dirname(src), "_vertical_export")
    if params.get("subfolder"):
        out_dir = os.path.join(out_dir, params["subfolder"])
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, f"{base_name}.{ext}")

    # DUPLICATE / EXISTING FILE CONFLICT SYSTEM:
    # 1. Skip (ข้ามคลิปที่มีอยู่แล้ว)
    # 2. Change Extension (เปลี่ยนนามสกุล เช่น .mp4 -> .mov / .mkv)
    # 3. Rename (รันเลขต่อท้าย เช่น _01, _02)
    # 4. Overwrite (เขียนทับไฟล์เดิมทั้งหมด)
    if os.path.exists(out_file) and os.path.getsize(out_file) > 50000:
        if conflict == "skip":
            with proc_lock:
                if src not in p["completed_paths"]:
                    p["completed_paths"].append(src)
                    done_count = len(p["completed_paths"])
                    p["percent"] = (done_count / total) * 100.0
                    elapsed = time.time() - start_time
                    if done_count > 0:
                        avg_time = elapsed / done_count
                        rem_sec = int(avg_time * (total - done_count))
                        p["remaining_str"] = f"{rem_sec // 60:02d}m {rem_sec % 60:02d}s"
                        p["eta_str"] = time.strftime("%H:%M", time.localtime(time.time() + rem_sec))
            return src
        elif conflict == "change_ext":
            alt_formats = ["mov", "mp4", "mkv", "webm", "m4v"]
            found_alt = False
            for alt_ext in alt_formats:
                if alt_ext == ext:
                    continue
                test_file = os.path.join(out_dir, f"{base_name}.{alt_ext}")
                if not os.path.exists(test_file):
                    ext = alt_ext
                    out_file = test_file
                    found_alt = True
                    break
            if not found_alt:
                counter = 1
                while os.path.exists(os.path.join(out_dir, f"{base_name}_{counter:02d}.{ext}")):
                    counter += 1
                out_file = os.path.join(out_dir, f"{base_name}_{counter:02d}.{ext}")
        elif conflict == "rename":
            counter = 1
            while os.path.exists(os.path.join(out_dir, f"{base_name}_{counter:02d}.{ext}")):
                counter += 1
            out_file = os.path.join(out_dir, f"{base_name}_{counter:02d}.{ext}")
        elif conflict == "overwrite":
            try:
                os.remove(out_file)
            except:
                pass

    # Audio and Color Range detection (Nikon Z8 / Full Range vs Limited Range)
    has_audio = False
    is_full_range = False
    try:
        probe_cmd = [FFMPEG_BIN, "-nostdin", "-i", src]
        p_res = subprocess.run(probe_cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, stdin=subprocess.DEVNULL, text=True, errors="ignore")
        if "Audio:" in p_res.stderr:
            has_audio = True
        err_lower = p_res.stderr.lower()
        if "yuvj" in err_lower or "(pc" in err_lower or "pc," in err_lower or "pc)" in err_lower or "full" in err_lower:
            is_full_range = True
    except:
        pass

    vf = list(vf_base)
    # Zoom & Resolution Scaling (Supports Preset & Custom WxH + Fit / Crop / Stretch)
    zx = max(0.5, min(4.0, float(params.get("zoom_x", 1.0))))
    zy = max(0.5, min(4.0, float(params.get("zoom_y", 1.0))))
    if zx > 1.01 or zy > 1.01:
        vf.append(f"crop=iw/{zx:.3f}:ih/{zy:.3f}:(iw-ow)/2:(ih-oh)/2")

    res_param = str(params.get("resolution", "1080x1920")).lower().strip()
    scaling_mode = str(params.get("scaling_mode", "fit")).lower().strip()
    target_w, target_h = 1080, 1920
    if "x" in res_param:
        parts = res_param.split("x")
        if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
            target_w = max(256, int(parts[0]))
            target_h = max(256, int(parts[1]))
            # Ensure even dimensions for hardware encoders
            target_w = (target_w // 2) * 2
            target_h = (target_h // 2) * 2

    scale_range = ":in_range=full:out_range=tv" if is_full_range else ""
    if scaling_mode == "crop":
        vf.append(f"scale={target_w}:{target_h}{scale_range}:force_original_aspect_ratio=increase,crop={target_w}:{target_h}")
    elif scaling_mode == "stretch":
        vf.append(f"scale={target_w}:{target_h}{scale_range}")
    else:
        vf.append(f"scale={target_w}:{target_h}{scale_range}:force_original_aspect_ratio=decrease,pad={target_w}:{target_h}:(ow-iw)/2:(oh-ih)/2")

    # Speed Change (Retime)
    spd = max(25.0, min(400.0, float(params.get("speed", 100.0))))
    spd_dir = str(params.get("speed_direction", "forward")).lower()
    if abs(spd - 100.0) > 0.5:
        vf.append(f"setpts={100.0 / spd:.4f}*PTS")
    if spd_dir == "reverse":
        vf.append("reverse")

    # Nikon Picture Control, Tone Profiles & Color Grading (Unified High-Precision Pipeline)
    render_timeline_effects = params.get("render_timeline_effects", True)
    if not render_timeline_effects:
        nikon_profile = "none"
        nikon_strength = 0.0
        custom_lut_path = ""
        user_brightness = 0.0
        user_contrast = 1.0
        user_shadows = 0.0
        user_saturation = 1.0
        tot_contrast = 1.0
        tot_saturation = 1.0
        tot_brightness = 0.0
        tot_gamma = 1.0
        temp = 0.0
        tint = 0.0
        r_mult = 1.0
        b_mult = 1.0
        g_mult = 1.0
    else:
        nikon_profile = (params.get("nikon_profile") or params.get("nikonProfile") or "").lower()
        nikon_strength = float(params.get("nikon_strength") or params.get("nikonStrength") or 100) / 100.0
        custom_lut_path = params.get("custom_lut_path") or params.get("customLutPath") or ""

        user_brightness = float(params.get("brightness", 0.0))
        user_contrast = float(params.get("contrast", 1.0))
        user_highlights = float(params.get("highlights", 0.0))
        user_shadows = float(params.get("shadows", 0.0))
        user_whites = float(params.get("whites", 0.0))
        user_blacks = float(params.get("blacks", 0.0))
        user_texture = float(params.get("texture", 0.0))
        user_clarity = float(params.get("clarity", 0.0))
        user_dehaze = float(params.get("dehaze", 0.0))
        user_vibrance = float(params.get("vibrance", 0.0))
        user_saturation = float(params.get("saturation", 1.0))

        # Calibrated 1:1 with WebKit Monitor Preview (Tone & Presence engine)
        tot_contrast = user_contrast * (1.0 + (user_clarity * 0.0035) + (user_dehaze * 0.0030) + (user_whites * 0.0015) - (user_blacks * 0.0015))
        tot_saturation = user_saturation * (1.0 + (user_vibrance * 0.0040) + (user_dehaze * 0.0025))
        tot_brightness = user_brightness + (user_shadows * 0.0030) + (user_highlights * 0.0020) + (user_whites * 0.0025) + (user_blacks * 0.0018) - (user_dehaze * 0.0015)
        tot_gamma = 1.0

        if user_texture > 5:
            vf.append(f"unsharp=3:3:{min(1.5, user_texture * 0.012):.2f}")
        elif user_texture < -5:
            vf.append(f"smartblur=lr={min(2.0, abs(user_texture) * 0.015):.2f}:ls=-0.25")

        temp = float(params.get("temperature", 0.0))
        tint = float(params.get("tint", 0.0))
        # Calibrated white balance temperature & tint scaling to match Monitor preview
        r_mult = 1.0 + (temp * 0.0032) + (tint * 0.0022)
        b_mult = 1.0 - (temp * 0.0032) + (tint * 0.0022)
        g_mult = 1.0 - (tint * 0.0032)

    is_mono = False

    if nikon_profile == "custom" and custom_lut_path and os.path.isfile(custom_lut_path):
        vf.append(f"lut3d=file='{custom_lut_path}':interp=tetrahedral")
    elif nikon_strength > 0.001 and nikon_profile not in ["", "none"]:
        f = nikon_strength
        if nikon_profile == "nlog_rec709":
            tot_contrast *= (1.0 + 0.35 * f)
            tot_saturation *= (1.0 + 0.40 * f)
            tot_brightness += 0.02 * f
            tot_gamma *= (1.0 + 0.06 * f)
        elif nikon_profile == "rich_portrait":
            tot_contrast *= (1.0 + 0.18 * f)
            tot_saturation *= (1.0 + 0.28 * f)
            tot_brightness += 0.03 * f
            tot_gamma *= (1.0 + 0.12 * f)
            r_mult *= (1.0 + 0.08 * f)
            b_mult *= (1.0 - 0.05 * f)
        elif nikon_profile == "portrait":
            tot_contrast *= (1.0 + 0.15 * f)
            tot_saturation *= (1.0 + 0.22 * f)
            tot_brightness += 0.02 * f
            tot_gamma *= (1.0 + 0.08 * f)
            r_mult *= (1.0 + 0.05 * f)
            b_mult *= (1.0 - 0.04 * f)
        elif nikon_profile in ["skin_soft", "skin"]:
            tot_contrast *= (1.0 + 0.10 * f)
            tot_saturation *= (1.0 + 0.18 * f)
            tot_brightness += 0.03 * f
            tot_gamma *= (1.0 + 0.10 * f)
            r_mult *= (1.0 + 0.06 * f)
            b_mult *= (1.0 - 0.04 * f)
        elif nikon_profile == "neutral":
            tot_contrast *= (1.0 + 0.04 * f)
            tot_saturation *= (1.0 + 0.06 * f)
        elif nikon_profile == "vivid":
            tot_contrast *= (1.0 + 0.35 * f)
            tot_saturation *= (1.0 + 0.50 * f)
            tot_brightness += 0.01 * f
            tot_gamma *= (1.0 - 0.04 * f)
        elif nikon_profile == "flat":
            tot_contrast *= (1.0 - 0.12 * f)
            tot_saturation *= (1.0 - 0.08 * f)
            tot_brightness += 0.04 * f
            tot_gamma *= (1.0 + 0.22 * f)
        elif nikon_profile == "dream":
            tot_contrast *= (1.0 - 0.06 * f)
            tot_saturation *= (1.0 + 0.15 * f)
            tot_brightness += 0.04 * f
            tot_gamma *= (1.0 + 0.16 * f)
            r_mult *= (1.0 + 0.05 * f)
            b_mult *= (1.0 - 0.03 * f)
        elif nikon_profile == "morning":
            tot_contrast *= (1.0 + 0.16 * f)
            tot_saturation *= (1.0 + 0.22 * f)
            tot_brightness += 0.03 * f
            r_mult *= (1.0 + 0.02 * f)
            b_mult *= (1.0 + 0.04 * f)
        elif nikon_profile == "pop":
            tot_contrast *= (1.0 + 0.28 * f)
            tot_saturation *= (1.0 + 0.55 * f)
            tot_brightness += 0.02 * f
        elif nikon_profile in ["bleach_bypass", "bleach"]:
            tot_contrast *= (1.0 + 0.45 * f)
            tot_saturation *= (1.0 - 0.45 * f)
            tot_brightness -= 0.01 * f
        elif nikon_profile == "denim":
            tot_contrast *= (1.0 + 0.22 * f)
            tot_saturation *= (1.0 + 0.15 * f)
            b_mult *= (1.0 + 0.12 * f)
            r_mult *= (1.0 - 0.06 * f)
        elif nikon_profile == "sunday":
            tot_contrast *= (1.0 + 0.08 * f)
            tot_saturation *= (1.0 + 0.15 * f)
            tot_brightness += 0.03 * f
            tot_gamma *= (1.0 + 0.12 * f)
            r_mult *= (1.0 + 0.05 * f)
            b_mult *= (1.0 - 0.03 * f)
        elif nikon_profile == "somber":
            tot_contrast *= (1.0 - 0.08 * f)
            tot_saturation *= (1.0 - 0.25 * f)
            tot_brightness += 0.02 * f
            tot_gamma *= (1.0 + 0.18 * f)
        elif nikon_profile == "dramatic":
            tot_contrast *= (1.0 + 0.40 * f)
            tot_saturation *= (1.0 + 0.25 * f)
            tot_brightness -= 0.02 * f
            tot_gamma *= (1.0 - 0.08 * f)
        elif nikon_profile == "silence":
            tot_contrast *= (1.0 - 0.15 * f)
            tot_saturation *= (1.0 - 0.35 * f)
            tot_brightness += 0.04 * f
            tot_gamma *= (1.0 + 0.15 * f)
        elif nikon_profile == "melancholic":
            tot_contrast *= (1.0 + 0.10 * f)
            tot_saturation *= (1.0 - 0.12 * f)
            b_mult *= (1.0 + 0.14 * f)
            r_mult *= (1.0 - 0.05 * f)
        elif nikon_profile == "pure":
            tot_contrast *= (1.0 + 0.12 * f)
            tot_saturation *= (1.0 + 0.10 * f)
            tot_brightness += 0.04 * f
            tot_gamma *= (1.0 + 0.10 * f)
        elif nikon_profile == "toy":
            tot_contrast *= (1.0 + 0.28 * f)
            tot_saturation *= (1.0 + 0.35 * f)
            tot_gamma *= (1.0 - 0.06 * f)
        elif nikon_profile == "sepia":
            is_mono = True
            tot_contrast *= (1.0 + 0.20 * f)
            r_mult *= (1.0 + 0.18 * f)
            b_mult *= (1.0 - 0.15 * f)
        elif nikon_profile == "monochrome":
            is_mono = True
            tot_contrast *= (1.0 + 0.38 * f)
            tot_brightness -= 0.02 * f
    elif params.get("nlog_normalize", False):
        tot_contrast *= 1.35
        tot_saturation *= 1.40
        tot_brightness += 0.02

    p_hue = 0.0
    p_bright = 0.0
    if render_timeline_effects:
        # Skin Tone & Aura Engine (Hue: -50 Golden Amber ↔ +50 Rosy Pink | Radiance: -50 ↔ +50 Midtone Lift)
        # Handled selectively inside bake_davinci_grade_lut() so neutral greys/roads are 100% protected!
        p_hue = float(params.get("portrait_hue", 0.0))
        p_bright = float(params.get("portrait_brightness", 0.0))

        # Skin Softening (Smart Surface Smoothing)
        skin_raw = params.get("skin_softening", 0.0)
        if isinstance(skin_raw, str):
            if skin_raw.lower() == "low": skin_soft = 0.35
            elif skin_raw.lower() == "normal": skin_soft = 0.65
            elif skin_raw.lower() == "high": skin_soft = 0.95
            else:
                try: skin_soft = float(skin_raw.replace("%", "")) / 100.0
                except: skin_soft = 0.0
        else:
            skin_soft = float(skin_raw) / 100.0

        if (nikon_profile in ["skin_soft", "skin"] or skin_soft > 0.05):
            eff_soft = skin_soft if skin_soft > 0.05 else (0.6 * nikon_strength)
            r = 1.0 + (eff_soft * 0.8)
            s = -0.3 - (eff_soft * 0.5)
            vf.append(f"smartblur=lr={r:.2f}:ls={s:.2f}")

    # Video Noise Reduction (Nikon High ISO NR & 3D Denoise)
    denoise_mode = (params.get("denoise_mode") or "off").lower()
    denoise_spatial = float(params.get("denoise_spatial", 0.0))
    denoise_temporal = float(params.get("denoise_temporal", 0.0))

    if denoise_mode in ["low", "light"]:
        vf.append("hqdn3d=2.0:1.5:2.5:2.0")
    elif denoise_mode in ["normal", "medium"]:
        vf.append("hqdn3d=4.0:3.0:4.5:3.5")
    elif denoise_mode in ["high", "strong"]:
        vf.append("hqdn3d=7.0:5.0:7.0:5.0")
    elif denoise_mode == "custom" and (denoise_spatial > 0.1 or denoise_temporal > 0.1):
        sp = max(0.5, min(10.0, denoise_spatial))
        tp = max(0.5, min(10.0, denoise_temporal))
        vf.append(f"hqdn3d={sp:.1f}:{sp*0.75:.1f}:{tp:.1f}:{tp*0.75:.1f}")

    tot_contrast = max(0.2, min(2.5, tot_contrast))
    tot_saturation = max(0.0, min(3.0, tot_saturation))
    # Calibrated Lumetri Exposure/Brightness Multiplier (Matches WebKit CSS brightness 1:1 without washing out black point)
    br_multiplier = max(0.1, min(2.5, 1.0 + tot_brightness))

    r_gain = max(0.1, min(3.0, br_multiplier * r_mult))
    g_gain = max(0.1, min(3.0, br_multiplier * g_mult))
    b_gain = max(0.1, min(3.0, br_multiplier * b_mult))

    if (abs(r_gain - 1.0) > 0.003 or abs(g_gain - 1.0) > 0.003 or abs(b_gain - 1.0) > 0.003):
        vf.append(f"colorchannelmixer=rr={r_gain:.3f}:gg={g_gain:.3f}:bb={b_gain:.3f}")

    tot_gamma = max(0.3, min(2.5, tot_gamma))
    if is_mono:
        vf.append(f"hue=s=0,eq=contrast={tot_contrast:.3f}:gamma={tot_gamma:.3f}")
    elif (abs(tot_contrast - 1.0) > 0.003 or abs(tot_saturation - 1.0) > 0.003 or abs(tot_gamma - 1.0) > 0.003):
        vf.append(f"eq=contrast={tot_contrast:.3f}:saturation={tot_saturation:.3f}:gamma={tot_gamma:.3f}")

    # DaVinci ColorSlice (7-Vector) + Primaries Color Bars (Lift/Gamma/Gain/Offset) + Selective Skin Tone -> 3D LUT (.cube)
    if render_timeline_effects:
        cs_data = params.get("color_slice")
        pb_data = params.get("primaries_bars")
        baked_lut = bake_davinci_grade_lut(cs_data, pb_data, p_hue, p_bright)
        if baked_lut and os.path.exists(baked_lut):
            safe_baked = baked_lut.replace("\\", "/").replace(":", "\\:")
            vf.append(f"lut3d=file='{safe_baked}':interp=tetrahedral")

    # Lock RGB <-> YUV conversion strictly to BT.709 TV range (prevents FFmpeg swscale BT.601 color shift on macOS!)
    if any(("colorchannelmixer" in f or "lut3d" in f) for f in vf):
        vf.append("scale=in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv,format=yuv420p")

    codec_req = (params.get("codec") or "h264").lower()
    is_prores = "prores" in codec_req
    is_hevc = codec_req in ["hevc", "h265"]
    is_webm = (ext == "webm" or codec_req == "vp9")
    raw_trims = params.get("clip_trims") or {}
    clip_trims = {}
    for k, v in raw_trims.items():
        if not k:
            continue
        clip_trims[k] = v
        try:
            clip_trims[str(Path(k).resolve())] = v
        except Exception:
            pass
    try:
        trim_start = float(clip_trims.get(src) or clip_trims.get(str(Path(src).resolve()), 0) or clip_info.get("trim_start", 0) or 0)
    except Exception:
        trim_start = 0.0

    def execute_ffmpeg(enc_codec, use_hwaccel=True):
        cmd = [FFMPEG_BIN, "-nostdin", "-y"]
        # Dedicated hardware decoding via GPU Media Engine
        if use_hwaccel:
            if sys.platform == "darwin":
                cmd.extend(["-hwaccel", "videotoolbox"])
            elif sys.platform == "win32":
                if "nvenc" in enc_codec:
                    cmd.extend(["-hwaccel", "cuda"])
                else:
                    cmd.extend(["-hwaccel", "auto"])
        if trim_start > 0.05:
            cmd.extend(["-ss", f"{trim_start:.3f}"])
        cmd.extend(["-i", src])
        if is_prores:
            prof = 2  # Standard ProRes 422
            if "hq" in codec_req: prof = 3
            elif "lt" in codec_req: prof = 1
            cmd.extend(["-c:v", enc_codec, "-profile:v", str(prof)])
            if enc_codec == "prores_ks":
                cmd.extend(["-vendor", "apl0", "-pix_fmt", "yuv422p10le"])
        elif is_hevc:
            cmd.extend([
                "-c:v", enc_codec, "-b:v", bitrate,
                "-pix_fmt", "yuv420p", "-color_range", "tv", "-tag:v", "hvc1",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"
            ])
            if enc_codec == "libx265":
                cmd.extend(["-preset", "ultrafast"])
        elif is_webm:
            cmd.extend([
                "-c:v", enc_codec, "-b:v", bitrate,
                "-pix_fmt", "yuv420p"
            ])
        else:
            cmd.extend([
                "-c:v", enc_codec, "-b:v", bitrate,
                "-pix_fmt", "yuv420p", "-color_range", "tv",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"
            ])
            if enc_codec == "h264_videotoolbox":
                # Apple VideoToolbox rate-control calibration: caps bitrate on high-motion clips so file size doesn't blow up
                try:
                    num_k = int("".join([c for c in str(bitrate) if c.isdigit()]))
                except Exception:
                    num_k = 8000
                if num_k <= 4500:
                    vt_q = 50
                elif num_k <= 6500:
                    vt_q = 55
                elif num_k <= 9000:
                    vt_q = 58
                elif num_k <= 12000:
                    vt_q = 60
                elif num_k <= 16000:
                    vt_q = 62
                else:
                    vt_q = 65
                cmd.extend(["-q:v", str(vt_q)])
            elif enc_codec == "libx264":
                cmd.extend(["-preset", "ultrafast"])

        if ext in ["mp4", "mov", "m4v"]:
            cmd.extend(["-movflags", "+faststart"])

        cmd.extend(["-progress", "pipe:1", "-nostats"])

        if vf:
            cmd.extend(["-vf", ",".join(vf)])

        export_audio = params.get("export_audio", True)
        if has_audio and export_audio:
            if is_webm:
                cmd.extend(["-c:a", "libopus", "-b:a", "128k"])
            else:
                acodec = params.get("audio_codec", "aac")
                if acodec == "copy":
                    cmd.extend(["-c:a", "copy"])
                elif acodec == "pcm":
                    cmd.extend(["-c:a", "pcm_s16le"])
                else:
                    abitrate = params.get("audio_bitrate", "320k")
                    cmd.extend(["-c:a", "aac", "-b:a", abitrate])
        else:
            cmd.append("-an")

        cmd.extend(["-r", "25", out_file])

        proc = None
        try:
            proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL,
                text=True, bufsize=1, universal_newlines=True
            )
            add_active_proc(proc)
            while True:
                while STATE["is_paused"] and not STATE["cancel_requested"]:
                    time.sleep(0.2)
                if STATE["cancel_requested"]:
                    try: proc.terminate()
                    except: pass
                    break
                line = proc.stdout.readline()
                if not line and proc.poll() is not None:
                    break
                line = line.strip()
                if "=" in line:
                    k, v = line.split("=", 1)
                    if k == "speed":
                        v_clean = v.strip()
                        p["speed"] = v_clean if v_clean.endswith("x") else f"{v_clean}x"
                    elif k == "out_time_us" and total > 0:
                        try:
                            cur_sec = float(v.strip()) / 1_000_000.0
                            clip_dur = float(clip_info.get("duration") or 0)
                            if clip_dur > 0.1:
                                clip_frac = min(0.98, max(0.0, cur_sec / clip_dur))
                                with proc_lock:
                                    done_count = len(p["completed_paths"])
                                    live_pct = ((done_count + clip_frac) / total) * 100.0
                                    if live_pct > p["percent"]:
                                        p["percent"] = min(99.5, live_pct)
                        except Exception:
                            pass
            proc.wait()
            remove_active_proc(proc)
            return proc.returncode
        except Exception:
            if proc:
                remove_active_proc(proc)
            return 1
        finally:
            if proc and proc.stdout:
                try: proc.stdout.close()
                except Exception: pass

    # Attempt 1: Target Hardware Encoder (Apple VideoToolbox / NVENC) with GPU Hardware Decoder
    rc = execute_ffmpeg(codec, use_hwaccel=True)

    # Attempt 2: Auto-retry hardware if session was busy
    if (rc != 0 or not os.path.exists(out_file) or os.path.getsize(out_file) < 1000) and not STATE["cancel_requested"]:
        if os.path.exists(out_file):
            try: os.remove(out_file)
            except: pass
        time.sleep(0.3)
        rc = execute_ffmpeg(codec, use_hwaccel=True)

    # Attempt 3: Software Fallback if hardware encoder temporarily exhausted
    if (rc != 0 or not os.path.exists(out_file) or os.path.getsize(out_file) < 1000) and not STATE["cancel_requested"]:
        if os.path.exists(out_file):
            try: os.remove(out_file)
            except: pass
        time.sleep(0.2)
        fallback_codec = "libx264"
        if is_prores:
            fallback_codec = "prores_ks"
        elif is_hevc:
            fallback_codec = "libx265"
        elif is_webm:
            fallback_codec = "libvpx-vp9"
        execute_ffmpeg(fallback_codec, use_hwaccel=False)

    # Immediately purge RAM, OS page cache, and file buffers after EVERY clip
    purge_system_and_process_ram(out_file)
    purge_system_and_process_ram(src)

    if not STATE["cancel_requested"] and os.path.exists(out_file) and os.path.getsize(out_file) > 1000:
        with proc_lock:
            p["completed_paths"].append(src)
            done_count = len(p["completed_paths"])
            p["percent"] = (done_count / total) * 100.0
            elapsed = time.time() - start_time
            if done_count > 0:
                avg_time = elapsed / done_count
                rem_sec = int(avg_time * (total - done_count))
                p["remaining_str"] = f"{rem_sec // 60:02d}m {rem_sec % 60:02d}s"
                p["eta_str"] = time.strftime("%H:%M", time.localtime(time.time() + rem_sec))
        return src
    else:
        # Fallback counting so UI progress never freezes at 0%
        with proc_lock:
            if src not in p["completed_paths"]:
                p["completed_paths"].append(src)
                done_count = len(p["completed_paths"])
                p["percent"] = (done_count / total) * 100.0
        return None


def run_batch_export(params):
    STATE["is_exporting"] = True
    STATE["cancel_requested"] = False
    STATE["is_paused"] = False
    p = STATE["progress"]
    raw_paths = params.get("paths", [])
    selected_paths = set(raw_paths) | {str(Path(sp).resolve()) for sp in raw_paths if sp}
    if selected_paths:
        clips_to_process = [c for c in STATE["clips"] if c["path"] in selected_paths or str(Path(c["path"]).resolve()) in selected_paths]
    else:
        clips_to_process = STATE["clips"]

    total = len(clips_to_process)
    p["total"] = total
    p["status"] = "Rendering..."
    p["completed_paths"] = []
    p["percent"] = 0.0
    p["remaining_str"] = "Calculating..."
    p["eta_str"] = "--:--"
    start_time = time.time()

    # Prevent macOS Sleep during long batch exports (2,000 - 5,000+ clips)
    caffeinate_proc = None
    if sys.platform == "darwin":
        try:
            caffeinate_proc = subprocess.Popen(["caffeinate", "-dis"])
        except Exception:
            pass

    # Rotation defaults to 0.0
    rot = float(params.get("rotation", 0.0))
    cl = float(params.get("crop_left", 0.0))
    cr = float(params.get("crop_right", 0.0))
    ct = float(params.get("crop_top", 0.0))
    cb = float(params.get("crop_bottom", 0.0))
    bitrate = params.get("bitrate", "8000k")
    codec = get_best_encoder(FFMPEG_BIN, params.get("codec", "h264"))

    vf_base = []
    if cl > 0 or cr > 0 or ct > 0 or cb > 0:
        vf_base.append(f"crop=iw*(1-{cl:.3f}-{cr:.3f}):ih*(1-{ct:.3f}-{cb:.3f}):iw*{cl:.3f}:ih*{ct:.3f}")

    if rot == 90.0 or rot == -270.0:
        vf_base.append("transpose=1")
    elif rot == 270.0 or rot == -90.0:
        vf_base.append("transpose=2")
    elif rot == 180.0 or rot == -180.0:
        vf_base.append("hflip,vflip")
    elif rot != 0.0:
        rad = f"{rot}*PI/180"
        vf_base.append(f"rotate={rad}:bilinear=1:ow='rotw({rad})':oh='roth({rad})'")

    if params.get("flip_h"):
        vf_base.append("hflip")
    if params.get("flip_v"):
        vf_base.append("vflip")

    # On Apple Silicon M-series, 2 workers is rock-solid optimal for the dual-engine VideoToolbox
    workers = int(params.get("workers", 2))
    workers = max(1, min(workers, 4))

    work_items = [{"path": c["path"], "name": c["name"], "index": i} for i, c in enumerate(clips_to_process)]

    try:
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [
                executor.submit(process_single_clip, item, params, vf_base, codec, bitrate, total, start_time)
                for item in work_items
            ]
            for f in concurrent.futures.as_completed(futures):
                if STATE["cancel_requested"]:
                    break
    finally:
        # Release caffeinate sleep lock
        if caffeinate_proc:
            try:
                caffeinate_proc.terminate()
            except Exception:
                pass

    STATE["is_exporting"] = False
    STATE["is_paused"] = False
    p["percent"] = 100.0 if not STATE["cancel_requested"] else p["percent"]
    p["status"] = "Stopped" if STATE["cancel_requested"] else "Completed"
    p["remaining_str"] = "00m 00s"
    # Final full RAM and cache eviction after batch job ends
    purge_system_and_process_ram()

    # Refresh macOS Finder QuickLook thumbnail cache so overwritten videos show new color thumbnails immediately
    if sys.platform == "darwin":
        try:
            subprocess.Popen(["qlmanage", "-r", "cache"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except Exception:
            pass

    # Native macOS completion notification
    if sys.platform == "darwin" and not STATE["cancel_requested"]:
        completed_count = len(p["completed_paths"])
        notify_msg = f"Finished exporting {completed_count} vertical clips to destination folder!"
        subprocess.run([
            "osascript", "-e",
            f'display notification "{notify_msg}" with title "ZCut PRO" subtitle "Batch Export Completed"'
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def analyze_blurry_intro(filepath, max_seconds=5.0, sensitivity="balanced"):
    """Offline AI/CV intro blur & camera-shake detector using FFmpeg + OpenCV + NumPy."""
    try:
        import cv2
        import numpy as np
    except ImportError as e:
        return {"path": filepath, "trim_start": 0.0, "error": f"OpenCV not available: {e}"}

    if not filepath or not os.path.exists(filepath):
        return {"path": filepath, "trim_start": 0.0, "error": "File not found"}

    ext = os.path.splitext(filepath)[1].lower()
    if ext in [".jpg", ".jpeg", ".png", ".heic", ".webp", ".tiff"]:
        return {"path": filepath, "trim_start": 0.0, "duration": 0.0, "status": "image"}

    sample_fps = 7.0
    w, h = 320, 180
    frame_bytes = w * h
    cmd = [
        FFMPEG_BIN, "-nostdin", "-v", "error",
        "-t", f"{float(max_seconds):.2f}",
        "-i", filepath,
        "-vf", f"fps={sample_fps},scale={w}:{h}:flags=bilinear,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        raw = proc.stdout
    except Exception as e:
        return {"path": filepath, "trim_start": 0.0, "error": f"FFmpeg decode error: {e}"}

    n_frames = len(raw) // frame_bytes
    if n_frames < 3:
        return {"path": filepath, "trim_start": 0.0, "status": "too_short"}

    samples = []
    prev_gray = None
    cy0, cy1 = int(h * 0.15), int(h * 0.85)
    cx0, cx1 = int(w * 0.15), int(w * 0.85)

    for idx in range(n_frames):
        chunk = raw[idx * frame_bytes : (idx + 1) * frame_bytes]
        gray = np.frombuffer(chunk, dtype=np.uint8).reshape((h, w))
        center = gray[cy0:cy1, cx0:cx1]

        lap_full = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        lap_center = float(cv2.Laplacian(center, cv2.CV_64F).var())
        sharpness = (lap_center * 0.7) + (lap_full * 0.3)

        motion = 0.0
        if prev_gray is not None:
            motion = float(np.mean(cv2.absdiff(gray, prev_gray)))
        prev_gray = gray

        samples.append({"t": round(idx / sample_fps, 2), "sharp": sharpness, "motion": motion})

    sharp_vals = np.array([s["sharp"] for s in samples], dtype=np.float64)
    ref_sharp = float(np.percentile(sharp_vals, 75))
    if ref_sharp < 12.0:
        return {"path": filepath, "trim_start": 0.0, "status": "low_detail"}

    ratio_map = {"gentle": 0.42, "balanced": 0.58, "strict": 0.72}
    motion_map = {"gentle": 24.0, "balanced": 16.0, "strict": 11.0}
    ratio = ratio_map.get(sensitivity, 0.58)
    motion_limit = motion_map.get(sensitivity, 16.0)
    sharp_thresh = ref_sharp * ratio

    trim_start = 0.0
    for i in range(len(samples) - 1):
        s0, s1 = samples[i], samples[i + 1]
        ok0 = s0["sharp"] >= sharp_thresh and s0["motion"] <= motion_limit
        ok1 = s1["sharp"] >= sharp_thresh and s1["motion"] <= motion_limit
        if ok0 and ok1:
            trim_start = s0["t"]
            break
    else:
        best = max(samples, key=lambda s: s["sharp"])
        trim_start = best["t"]

    if trim_start < 0.25:
        trim_start = 0.0
    trim_start = round(min(trim_start, max(0.0, (n_frames - 2) / sample_fps)), 2)

    return {
        "path": filepath,
        "trim_start": trim_start,
        "ref_sharp": round(ref_sharp, 1),
        "status": "trimmed" if trim_start > 0 else "sharp_from_start",
    }


def batch_analyze_blurry_intros(paths, max_seconds=5.0, sensitivity="balanced"):
    if not paths:
        return {"success": True, "results": []}
    results = []
    for p in paths:
        try:
            results.append(analyze_blurry_intro(p, max_seconds, sensitivity))
        except Exception as e:
            results.append({"path": p, "trim_start": 0.0, "error": str(e)})
    return {"success": True, "results": results}


def analyze_whole_clip_blur(filepath, sensitivity="balanced"):
    """Offline AI/CV whole-clip blur screener using FFmpeg + OpenCV Laplacian."""
    try:
        import cv2
        import numpy as np
    except ImportError as e:
        return {"path": filepath, "is_blurry": False, "error": f"OpenCV not available: {e}"}

    if not filepath or not os.path.exists(filepath):
        return {"path": filepath, "is_blurry": False, "error": "File not found"}

    ext = os.path.splitext(filepath)[1].lower()
    if ext in [".jpg", ".jpeg", ".png", ".heic", ".webp", ".tiff"]:
        return {"path": filepath, "is_blurry": False, "status": "image"}

    w, h = 320, 180
    frame_bytes = w * h
    cmd = [
        FFMPEG_BIN, "-nostdin", "-v", "error",
        "-i", filepath,
        "-vf", f"fps=1,scale={w}:{h}:flags=bilinear,format=gray",
        "-frames:v", "8",
        "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1",
    ]
    try:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        raw = proc.stdout
    except Exception as e:
        return {"path": filepath, "is_blurry": False, "error": f"FFmpeg decode error: {e}"}

    n_frames = len(raw) // frame_bytes
    if n_frames < 1:
        return {"path": filepath, "is_blurry": False, "status": "unreadable"}

    cy0, cy1 = int(h * 0.15), int(h * 0.85)
    cx0, cx1 = int(w * 0.15), int(w * 0.85)
    sharps = []
    for idx in range(n_frames):
        chunk = raw[idx * frame_bytes : (idx + 1) * frame_bytes]
        gray = np.frombuffer(chunk, dtype=np.uint8).reshape((h, w))
        center = gray[cy0:cy1, cx0:cx1]
        lap_full = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        lap_center = float(cv2.Laplacian(center, cv2.CV_64F).var())
        sharps.append((lap_center * 0.7) + (lap_full * 0.3))

    p75_sharp = float(np.percentile(np.array(sharps, dtype=np.float64), 75))
    thresh_map = {"gentle": 28.0, "balanced": 48.0, "strict": 75.0}
    thresh = thresh_map.get(sensitivity, 48.0)
    is_blurry = p75_sharp < thresh

    return {
        "path": filepath,
        "is_blurry": bool(is_blurry),
        "sharpness": round(p75_sharp, 1),
        "threshold": thresh,
        "status": "blurry_clip" if is_blurry else "sharp",
    }


def batch_analyze_whole_clips(paths, sensitivity="balanced"):
    if not paths:
        return {"success": True, "results": []}
    results = []
    for p in paths:
        try:
            results.append(analyze_whole_clip_blur(p, sensitivity))
        except Exception as e:
            results.append({"path": p, "is_blurry": False, "error": str(e)})
    return {"success": True, "results": results}


def analyze_auto_color(file_path):
    """Offline perceptual color science analyzer using FFmpeg + OpenCV/NumPy."""
    if not file_path or not os.path.exists(file_path):
        return {"success": False, "error": "ไม่พบไฟล์วิดีโอ/รูปภาพที่เลือก"}
    try:
        import cv2
        import numpy as np
    except Exception as e:
        return {"success": False, "error": f"Missing offline vision library: {e}"}

    clip_meta = next((c for c in STATE.get("clips", []) if c.get("path") == file_path), None)
    dur = float(clip_meta.get("duration") or 0) if clip_meta else 0.0
    is_image = bool(clip_meta and clip_meta.get("is_image")) or file_path.lower().endswith(
        (".jpg", ".jpeg", ".png", ".webp", ".nef", ".cr3", ".arw", ".dng")
    )

    sample_times = [0.0] if (is_image or dur <= 1.2) else [round(dur * 0.2, 2), round(dur * 0.5, 2), round(dur * 0.8, 2)]
    frames_bgr = []
    for t in sample_times:
        cmd = [FFMPEG_BIN, "-y", "-hide_banner", "-loglevel", "error"]
        if t > 0:
            cmd.extend(["-ss", str(t)])
        cmd.extend(["-i", file_path, "-vframes", "1", "-vf", "scale=320:-2", "-f", "image2pipe", "-vcodec", "png", "pipe:1"])
        try:
            proc = subprocess.run(cmd, capture_output=True, timeout=8)
            if proc.returncode == 0 and proc.stdout:
                arr = np.frombuffer(proc.stdout, dtype=np.uint8)
                img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
                if img is not None and img.size > 0:
                    frames_bgr.append(img)
        except Exception:
            continue

    if not frames_bgr:
        return {"success": False, "error": "ไม่สามารถดึงเฟรมตัวอย่างเพื่อวิเคราะห์สีได้"}

    # Combine sampled frames into one analysis batch
    stacked = np.concatenate([f.reshape(-1, 3) for f in frames_bgr], axis=0).astype(np.float32) / 255.0
    b_ch, g_ch, r_ch = stacked[:, 0], stacked[:, 1], stacked[:, 2]
    luma = 0.2126 * r_ch + 0.7152 * g_ch + 0.0722 * b_ch

    p5, p15, p50, p85, p95 = np.percentile(luma, [5, 15, 50, 85, 95])
    spread = float(p95 - p5)
    dark_ratio = float(np.mean(luma < 0.14))
    bright_ratio = float(np.mean(luma > 0.88))

    # 1. Exposure (brightness: -0.14..+0.15)
    target_mid = 0.44
    raw_exp = (target_mid - float(p50)) * 0.55
    if p95 > 0.88 and raw_exp > 0:
        raw_exp = min(raw_exp, max(0.0, (0.93 - float(p95)) * 0.6))
    brightness = round(max(-0.14, min(0.15, raw_exp)), 3)

    # 2. Highlights (-48..+18)
    highlights = 0
    if p95 > 0.84 or bright_ratio > 0.05:
        highlights = -int(round(min(48, max(8, (float(p95) - 0.80) * 180 + bright_ratio * 90))))
    elif p95 < 0.72:
        highlights = int(round(min(18, (0.76 - float(p95)) * 65)))

    # 3. Shadows (-10..+48)
    shadows = 0
    if p15 < 0.16 or dark_ratio > 0.14:
        shadows = int(round(min(48, max(10, (0.18 - float(p15)) * 220 + dark_ratio * 45))))

    # 4. Contrast (0.94..1.16)
    contrast = 1.0
    if spread < 0.50:
        contrast = round(min(1.16, 1.0 + (0.54 - spread) * 0.45), 2)
    elif spread > 0.74:
        contrast = round(max(0.95, 1.0 - (spread - 0.74) * 0.28), 2)

    # 5. White Balance (Lab neutral axis excluding clipped & extreme-chroma pixels)
    mid_img = frames_bgr[len(frames_bgr) // 2]
    lab = cv2.cvtColor(mid_img, cv2.COLOR_BGR2LAB).astype(np.float32)
    L_lab = lab[:, :, 0] / 255.0
    a_lab = lab[:, :, 1] - 128.0
    b_lab = lab[:, :, 2] - 128.0
    chroma = np.sqrt(a_lab ** 2 + b_lab ** 2)
    valid_mask = (L_lab >= 0.16) & (L_lab <= 0.84) & (chroma < 32.0)
    if np.count_nonzero(valid_mask) > 200:
        mean_a = float(np.median(a_lab[valid_mask]))
        mean_b = float(np.median(b_lab[valid_mask]))
    else:
        mean_a = float(np.median(a_lab))
        mean_b = float(np.median(b_lab))

    # b* > 0 means warm/yellow -> cool down (-temp); b* < 0 means cool/blue -> warm up (+temp)
    temperature = int(round(max(-22, min(22, -mean_b * 0.95))))
    tint = int(round(max(-14, min(14, -mean_a * 0.75))))

    # 6. Vibrance & Saturation (HSV midtone saturation)
    hsv = cv2.cvtColor(mid_img, cv2.COLOR_BGR2HSV).astype(np.float32)
    sat_med = float(np.median(hsv[:, :, 1]) / 255.0)
    if sat_med < 0.28:
        vibrance = int(round(min(24, max(8, (0.32 - sat_med) * 95))))
        saturation = round(min(1.08, 1.0 + (0.30 - sat_med) * 0.25), 2)
    elif sat_med > 0.45:
        vibrance = 0
        saturation = 1.0
    else:
        vibrance = 10
        saturation = 1.03

    parts = []
    if abs(brightness) >= 0.01:
        parts.append(f"Exp {brightness:+.2f}")
    if shadows != 0:
        parts.append(f"Shadow {shadows:+d}")
    if highlights != 0:
        parts.append(f"High {highlights:+d}")
    if temperature != 0:
        parts.append(f"Temp {temperature:+d}")
    if vibrance > 0:
        parts.append(f"Vib +{vibrance}")
    summary = " • ".join(parts) if parts else "แสงและสีสมดุลดีอยู่แล้ว"

    return {
        "success": True,
        "params": {
            "brightness": brightness,
            "contrast": contrast,
            "highlights": highlights,
            "shadows": shadows,
            "temperature": temperature,
            "tint": tint,
            "vibrance": vibrance,
            "saturation": saturation,
        },
        "summary": summary,
    }


def _parse_semver(v_str):
    parts = re.findall(r"\d+", str(v_str or "0"))
    nums = [int(x) for x in parts[:3]]
    while len(nums) < 3:
        nums.append(0)
    return tuple(nums)


def check_for_update():
    try:
        req = urllib.request.Request(
            f"{UPDATE_MANIFEST_URL}?t={int(time.time() // 60)}",
            headers={"User-Agent": f"ZCutPRO/{ZCUT_VERSION}"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            manifest = json.loads(resp.read().decode("utf-8"))
        latest = str(manifest.get("version") or ZCUT_VERSION).strip()
        has_update = _parse_semver(latest) > _parse_semver(ZCUT_VERSION)
        return {
            "success": True,
            "current_version": ZCUT_VERSION,
            "latest_version": latest,
            "has_update": has_update,
            "release_notes": manifest.get("releaseNotes", ""),
            "dmg_url": manifest.get("dmgUrl", DOWNLOAD_PAGE_URL),
            "update_zip_url": manifest.get("updateZipUrl", ""),
            "download_page": DOWNLOAD_PAGE_URL,
        }
    except Exception as e:
        return {
            "success": False,
            "current_version": ZCUT_VERSION,
            "latest_version": ZCUT_VERSION,
            "has_update": False,
            "error": str(e),
            "download_page": DOWNLOAD_PAGE_URL,
        }


def apply_remote_update(zip_url=""):
    if not zip_url:
        info = check_for_update()
        zip_url = info.get("update_zip_url") or ""
    if not zip_url:
        return {"success": False, "error": "ไม่พบลิงก์ไฟล์อัปเดต"}

    base_dir = APP_DIR
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            zip_path = os.path.join(tmpdir, "zcut-update.zip")
            req = urllib.request.Request(zip_url, headers={"User-Agent": f"ZCutPRO/{ZCUT_VERSION}"})
            with urllib.request.urlopen(req, timeout=30) as resp, open(zip_path, "wb") as out_f:
                shutil.copyfileobj(resp, out_f)

            extract_dir = os.path.join(tmpdir, "extracted")
            os.makedirs(extract_dir, exist_ok=True)
            with zipfile.ZipFile(zip_path, "r") as zf:
                for member in zf.namelist():
                    dest = os.path.abspath(os.path.join(extract_dir, member))
                    if os.path.commonpath([extract_dir, dest]) != extract_dir:
                        raise ValueError("Unsafe zip path")
                zf.extractall(extract_dir)

            srv_src = os.path.join(extract_dir, "server.py")
            web_src = os.path.join(extract_dir, "web")
            if os.path.exists(srv_src):
                shutil.copy2(srv_src, os.path.join(base_dir, "server.py"))
            if os.path.isdir(web_src):
                web_dst = os.path.join(base_dir, "web")
                shutil.copytree(web_src, web_dst, dirs_exist_ok=True)

        def _delayed_exec_restart():
            time.sleep(0.45)
            try:
                if SERVER_INSTANCE is not None:
                    SERVER_INSTANCE.server_close()
            except Exception:
                pass
            if getattr(sys, "frozen", False):
                os.execv(sys.executable, [sys.executable])
            else:
                os.execv(sys.executable, [sys.executable, os.path.abspath(__file__)])

        threading.Thread(target=_delayed_exec_restart, daemon=True).start()
        return {"success": True, "restarting": True, "message": "อัปเดตอัตโนมัติเรียบร้อย กำลังรีโหลดโปรแกรม..."}
    except Exception as e:
        return {"success": False, "error": str(e)}


def main():
    global SERVER_INSTANCE
    # Media Pool starts fresh and empty for new jobs
    # Settings are saved and loaded from ~/.turbocompress_studio_settings.json
    ThreadingHTTPServer.allow_reuse_address = True
    SERVER_INSTANCE = ThreadingHTTPServer(("127.0.0.1", PORT), StudioHandler)
    print(f"TurboCompress Studio Server running on http://127.0.0.1:{PORT}")
    SERVER_INSTANCE.serve_forever()

if __name__ == "__main__":
    main()
