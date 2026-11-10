#!/usr/bin/env python3
"""
TurboCompress Studio - High Performance Backend Server
Powers the DaVinci Resolve Cut Page Web App with Apple Silicon Hardware Engine
"""

import os
import sys
import re
import json
import time
import shutil
import signal
import urllib.parse
import threading
import subprocess
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = 8765
WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")
SETTINGS_PATH = os.path.expanduser("~/.turbocompress_studio_settings.json")

DEFAULT_SETTINGS = {
    "rotation": 270.0,
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
    "nikonProfile": "nlog_rec709",
    "nikonStrength": 100,
    "customLutPath": "",
    "brightness": 0.0,
    "contrast": 1.0,
    "shadows": 0.0,
    "saturation": 1.0,
    "outputPath": "/Users/siamratchongtong/Desktop/STD_VT/test_Exp",
    "fileNamePattern": "SourceName",
    "renderMode": "individual",
    "format": "mp4",
    "codec": "h264",
    "resolution": "1080x1920",
    "resW": "1080",
    "resH": "1920",
    "verticalRes": True,
    "qualityMode": "auto",
    "bitrateKbps": "80000",
    "exportAudio": True,
    "audioCodec": "aac",
    "audioBitrate": "320",
    "audioChannels": "2",
    "filenameUses": "source",
    "fileSubfolder": "",
    "smartResume": True,
    "workers": 2,
    "renderSpeed": "max"
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
    local_dir = os.path.dirname(os.path.abspath(__file__))
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

SUPPORTED_EXT = {".mp4", ".mov", ".m4v", ".mkv", ".avi", ".mts", ".m2ts", ".webm"}

STATE = {
    "clips": [],
    "output_dir": "/Users/siamratchongtong/Desktop/STD_VT/100NC_Z8/_vertical_export",
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

        if b"NIKON Z 8" in data:
            meta["camera_model"] = "Nikon Z8"
        elif b"NIKON Z 9" in data:
            meta["camera_model"] = "Nikon Z9"
        elif b"NIKON Z f" in data:
            meta["camera_model"] = "Nikon Zf"
        elif b"NIKON Z 6" in data:
            meta["camera_model"] = "Nikon Z6"
        elif b"NIKON" in data:
            meta["camera_model"] = "Nikon Camera"

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
                for f in files:
                    if not f.startswith("._") and Path(f).suffix.lower() in SUPPORTED_EXT:
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
            self.wfile.write(json.dumps(status_data).encode())
            return

        elif url.path == "/api/list-dir":
            dir_path = qs.get("path", ["/Users/siamratchongtong/Desktop"])[0]
            if not os.path.exists(dir_path) or not os.path.isdir(dir_path):
                dir_path = "/Users/siamratchongtong/Desktop"
            entries = []
            try:
                for entry in sorted(os.scandir(dir_path), key=lambda e: (not e.is_dir(), e.name.lower())):
                    if entry.name.startswith("."): continue
                    is_d = entry.is_dir()
                    video_count = 0
                    if is_d:
                        try:
                            video_count = sum(1 for f in os.scandir(entry.path) if not f.name.startswith("._") and Path(f.name).suffix.lower() in SUPPORTED_EXT)
                        except:
                            pass
                    entries.append({
                        "name": entry.name,
                        "path": entry.path,
                        "is_dir": is_d,
                        "video_count": video_count
                    })
            except Exception as e:
                pass
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"current": dir_path, "parent": str(Path(dir_path).parent), "entries": entries}).encode())
            return

        elif url.path == "/api/thumb":
            fpath = qs.get("path", [""])[0]
            if not fpath or not os.path.exists(fpath):
                self.send_error(404, "File not found")
                return
            thumb_cache_dir = "/tmp/tc_thumbs"
            os.makedirs(thumb_cache_dir, exist_ok=True)
            t_path = os.path.join(thumb_cache_dir, f"{os.path.basename(fpath)}.jpg")
            if not os.path.exists(t_path):
                subprocess.run([
                    FFMPEG_BIN, "-ss", "00:00:00.5", "-i", fpath,
                    "-vframes", "1", "-vf", "scale=240:-2", "-q:v", "5",
                    "-y", t_path
                ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                if not os.path.exists(t_path):
                    subprocess.run([
                        FFMPEG_BIN, "-i", fpath,
                        "-vframes", "1", "-vf", "scale=240:-2", "-q:v", "6",
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

        elif url.path == "/api/clear" or url.path == "/api/clear_on_exit":
            with proc_lock:
                STATE["clips"] = []
                STATE["progress"] = {
                    "current_idx": 0, "total": 0, "current_name": "", "percent": 0.0,
                    "speed": "0.0x", "remaining_str": "00m 00s", "status": "Ready",
                    "eta_str": "--:--", "completed_paths": []
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "total": 0}).encode())
            return

        elif url.path == "/api/browse-folder":
            default_dir = "/Users/siamratchongtong/Desktop/STD_VT"
            if not os.path.exists(default_dir):
                default_dir = "/Users/siamratchongtong/Desktop"
            osa_script = (
                'tell application "Finder"\n'
                '    activate\n'
                f'    set defLoc to POSIX file "{default_dir}"\n'
                '    set sel to choose folder with prompt "Select Video Folder / เลือกโฟลเดอร์วิดีโอ" default location defLoc\n'
                '    return POSIX path of sel\n'
                'end tell'
            )
            res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
            chosen = res.stdout.strip()
            added = 0
            if chosen and os.path.exists(chosen):
                added = scan_files([chosen])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": bool(chosen), "added": added, "path": chosen, "total": len(STATE["clips"])}).encode())
            return

        elif url.path == "/api/browse-files":
            default_dir = "/Users/siamratchongtong/Desktop/STD_VT/100NC_Z8"
            if not os.path.exists(default_dir):
                default_dir = "/Users/siamratchongtong/Desktop/STD_VT"
            osa_script = (
                'tell application "Finder"\n'
                '    activate\n'
                f'    set defLoc to POSIX file "{default_dir}"\n'
                '    set theFiles to choose file with prompt "Select Video Clips / เลือกไฟล์วิดีโอ" of type {"public.movie", "mp4", "mov", "m4v"} default location defLoc with multiple selections allowed\n'
                '    set res to ""\n'
                '    repeat with f in theFiles\n'
                '        set res to res & (POSIX path of f) & "\n"\n'
                '    end repeat\n'
                '    return res\n'
                'end tell'
            )
            res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
            paths = [p.strip() for p in res.stdout.strip().splitlines() if p.strip()]
            added = 0
            if paths:
                added = scan_files(paths)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": bool(paths), "added": added, "total": len(STATE["clips"])}).encode())
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

        elif url.path == "/api/clear":
            STATE["clips"].clear()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode())
            return

        elif url.path == "/api/export":
            if not STATE["is_exporting"] and STATE["clips"]:
                threading.Thread(target=run_batch_export, args=(data,), daemon=True).start()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True}).encode())
            return

        elif url.path == "/api/set-output-folder":
            chosen = data.get("output_dir", "").strip()
            if not chosen:
                cur_loc = STATE.get("output_dir", "/Users/siamratchongtong/Desktop/STD_VT")
                if not os.path.exists(cur_loc):
                    cur_loc = "/Users/siamratchongtong/Desktop"
                if sys.platform == "darwin":
                    osa_script = (
                        'tell application "Finder"\n'
                        '    activate\n'
                        f'    set defLoc to POSIX file "{cur_loc}"\n'
                        '    set sel to choose folder with prompt "Select or Create Destination Folder / เลือกหรือสร้างโฟลเดอร์ปลายทาง" default location defLoc\n'
                        '    return POSIX path of sel\n'
                        'end tell'
                    )
                    res = subprocess.run(["osascript", "-e", osa_script], capture_output=True, text=True)
                    chosen = res.stdout.strip()
                elif sys.platform == "win32":
                    ps_script = (
                        '[System.Reflection.Assembly]::LoadWithPartialName("System.Windows.Forms") | Out-Null; '
                        '$d = New-Object System.Windows.Forms.FolderBrowserDialog; '
                        '$d.Description = "Select or Create Destination Folder"; '
                        'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }'
                    )
                    res = subprocess.run(["powershell", "-NoProfile", "-Command", ps_script], capture_output=True, text=True)
                    chosen = res.stdout.strip()

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
            target_dir = STATE.get("output_dir", "/Users/siamratchongtong/Desktop/STD_VT/100NC_Z8/_vertical_export")
            os.makedirs(target_dir, exist_ok=True)
            if sys.platform == "win32":
                os.startfile(target_dir)
            else:
                subprocess.run(["open", target_dir])
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "output_dir": target_dir}).encode())
            return

        elif url.path == "/api/clear-cache":
            import gc
            freed = 0
            thumb_cache_dir = "/tmp/tc_thumbs"
            if os.path.exists(thumb_cache_dir):
                for f in os.scandir(thumb_cache_dir):
                    try:
                        freed += f.stat().st_size
                        os.remove(f.path)
                    except:
                        pass
            gc.collect()
            freed_mb = f"{freed / (1024*1024):.1f} MB"
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "freed": freed_mb}).encode())
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
        range_header = self.headers.get("Range", None)
        if not range_header:
            self.send_response(200)
            self.send_header("Content-Type", "video/mp4")
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
        self.send_header("Content-Type", "video/mp4")
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

    naming = params.get("naming_pattern", "suffix_vertical")
    stem = Path(clip_info['name']).stem
    if naming == "prefix_reel":
        base_name = f"Reel_{idx+1:03d}_{stem}"
    elif naming == "original_same":
        base_name = f"{stem}"
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

    # Audio detection
    has_audio = False
    try:
        probe_cmd = [FFMPEG_BIN, "-i", src]
        p_res = subprocess.run(probe_cmd, stderr=subprocess.PIPE, stdout=subprocess.DEVNULL, text=True, errors="ignore")
        if "Audio:" in p_res.stderr:
            has_audio = True
    except:
        pass

    vf = list(vf_base)
    # Resolution Scaling
    res_param = params.get("resolution", "1080x1920")
    if res_param == "2160x3840":
        vf.append("scale=2160:3840")
    elif res_param == "720x1280":
        vf.append("scale=720:1280")
    elif res_param == "1080x1920":
        vf.append("scale=1080:1920")

    # Nikon Picture Control, Tone Profiles & Color Grading (Unified High-Precision Pipeline)
    nikon_profile = (params.get("nikon_profile") or params.get("nikonProfile") or "").lower()
    nikon_strength = float(params.get("nikon_strength") or params.get("nikonStrength") or 100) / 100.0
    custom_lut_path = params.get("custom_lut_path") or params.get("customLutPath") or ""

    user_brightness = float(params.get("brightness", 0.0))
    user_contrast = float(params.get("contrast", 1.0))
    user_shadows = float(params.get("shadows", 0.0))
    user_saturation = float(params.get("saturation", 1.0))

    tot_contrast = user_contrast
    tot_saturation = user_saturation
    tot_brightness = user_brightness
    tot_gamma = 1.0 + (user_shadows * 0.8)

    temp = float(params.get("temperature", 0.0))
    tint = float(params.get("tint", 0.0))
    r_mult = 1.0 + (temp * 0.008) + (tint * 0.004)
    b_mult = 1.0 - (temp * 0.008) + (tint * 0.004)
    g_mult = 1.0 - (tint * 0.006)

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

    # Nikon Z8 Portrait Impression Balance (Hue & Brightness)
    p_hue = float(params.get("portrait_hue", 0.0))  # -10 to +10 (Amber to Magenta)
    p_bright = float(params.get("portrait_brightness", 0.0))  # -10 to +10
    if abs(p_hue) > 0.1:
        # positive = magenta/pink, negative = amber/yellow
        r_mult *= (1.0 + p_hue * 0.015)
        b_mult *= (1.0 + p_hue * 0.010)
    if abs(p_bright) > 0.1:
        tot_brightness += p_bright * 0.015
        tot_gamma *= (1.0 + p_bright * 0.02)

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
    tot_brightness = max(-1.0, min(1.0, tot_brightness))
    tot_gamma = max(0.5, min(2.5, tot_gamma))

    if is_mono:
        vf.append(f"hue=s=0,eq=contrast={tot_contrast:.3f}:brightness={tot_brightness:.3f}:gamma={tot_gamma:.3f}")
    elif (abs(tot_brightness) > 0.001 or abs(tot_contrast - 1.0) > 0.001 or abs(tot_gamma - 1.0) > 0.001 or abs(tot_saturation - 1.0) > 0.001):
        vf.append(f"eq=brightness={tot_brightness:.3f}:contrast={tot_contrast:.3f}:saturation={tot_saturation:.3f}:gamma={tot_gamma:.3f}")

    r_mult = max(0.5, min(1.5, r_mult))
    g_mult = max(0.5, min(1.5, g_mult))
    b_mult = max(0.5, min(1.5, b_mult))
    if (abs(r_mult - 1.0) > 0.005 or abs(g_mult - 1.0) > 0.005 or abs(b_mult - 1.0) > 0.005):
        vf.append(f"colorchannelmixer=rr={r_mult:.3f}:gg={g_mult:.3f}:bb={b_mult:.3f}")

    codec_req = (params.get("codec") or "h264").lower()
    is_prores = "prores" in codec_req
    is_hevc = codec_req in ["hevc", "h265"]
    is_webm = (ext == "webm" or codec_req == "vp9")

    def execute_ffmpeg(enc_codec):
        cmd = [FFMPEG_BIN, "-y", "-i", src]
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
                "-pix_fmt", "yuv420p", "-tag:v", "hvc1",
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
                "-pix_fmt", "yuv420p",
                "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"
            ])
            if enc_codec == "libx264":
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
                cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
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
                        p["speed"] = f"{v}x"
            proc.wait()
            remove_active_proc(proc)
            return proc.returncode
        except Exception:
            if proc:
                remove_active_proc(proc)
            return 1

    # Attempt 1: Target Hardware Encoder (Apple VideoToolbox / NVENC)
    rc = execute_ffmpeg(codec)

    # Attempt 2: Auto-retry hardware if session was busy
    if (rc != 0 or not os.path.exists(out_file) or os.path.getsize(out_file) < 1000) and not STATE["cancel_requested"]:
        if os.path.exists(out_file):
            try: os.remove(out_file)
            except: pass
        time.sleep(0.3)
        rc = execute_ffmpeg(codec)

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
        execute_ffmpeg(fallback_codec)

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
        import gc
        gc.collect()
        return src

    return None


def run_batch_export(params):
    STATE["is_exporting"] = True
    STATE["cancel_requested"] = False
    STATE["is_paused"] = False
    p = STATE["progress"]
    selected_paths = set(params.get("paths", []))
    if selected_paths:
        clips_to_process = [c for c in STATE["clips"] if c["path"] in selected_paths]
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

    # Rotation defaults to 270.0 (-90.0) for Nikon Z8 vertical shooting orientation
    rot = float(params.get("rotation", 270.0))
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

    # Native macOS completion notification
    if sys.platform == "darwin" and not STATE["cancel_requested"]:
        completed_count = len(p["completed_paths"])
        notify_msg = f"Finished exporting {completed_count} vertical clips to destination folder!"
        subprocess.run([
            "osascript", "-e",
            f'display notification "{notify_msg}" with title "TurboCompress Studio" subtitle "Batch Export Completed"'
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main():
    # Media Pool starts fresh and empty for new jobs
    # Settings are saved and loaded from ~/.turbocompress_studio_settings.json
    server = ThreadingHTTPServer(("127.0.0.1", PORT), StudioHandler)
    print(f"TurboCompress Studio Server running on http://127.0.0.1:{PORT}")
    server.serve_forever()

if __name__ == "__main__":
    main()
