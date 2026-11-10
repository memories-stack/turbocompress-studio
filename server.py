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

def get_best_encoder(ffmpeg_bin):
    if sys.platform == "darwin":
        return "h264_videotoolbox"
    elif sys.platform == "win32":
        try:
            res = subprocess.run([ffmpeg_bin, "-encoders"], capture_output=True, text=True, errors="ignore")
            out = res.stdout or ""
            if "h264_nvenc" in out:
                return "h264_nvenc"
            elif "h264_qsv" in out:
                return "h264_qsv"
            elif "h264_amf" in out:
                return "h264_amf"
        except:
            pass
        return "libx264"
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
            new_clips.append({
                "path": f,
                "name": os.path.basename(f),
                "size": os.path.getsize(f),
                "size_fmt": f"{os.path.getsize(f) / (1024*1024):.1f} MB",
                "mtime": os.path.getmtime(f),
                "fps": "25.000"
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

        super().do_GET()

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        content_len = int(self.headers.get("Content-Length", 0))
        post_body = self.rfile.read(content_len).decode()
        data = json.loads(post_body) if post_body else {}

        if url.path == "/api/browse-folder":
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

    # File Naming Pattern
    naming = params.get("naming_pattern", "suffix_vertical")
    stem = Path(clip_info['name']).stem
    if naming == "prefix_reel":
        out_name = f"Reel_{idx+1:03d}_{stem}.mp4"
    elif naming == "original_same":
        out_name = f"{stem}.mp4"
    else:
        out_name = f"{stem}_vertical.mp4"

    out_dir = params.get("output_dir") or STATE.get("output_dir") or os.path.join(os.path.dirname(src), "_vertical_export")
    if params.get("subfolder"):
        out_dir = os.path.join(out_dir, params["subfolder"])
    os.makedirs(out_dir, exist_ok=True)
    out_file = os.path.join(out_dir, out_name)

    # SMART RESUME: Check if destination file is already successfully exported (> 50KB)
    smart_resume = params.get("smart_resume", True)
    if smart_resume and os.path.exists(out_file) and os.path.getsize(out_file) > 50000:
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

    # Nikon Picture Control & Tone Profile Processing
    nikon_profile = params.get("nikon_profile", "")
    nikon_strength = float(params.get("nikon_strength", 100)) / 100.0
    custom_lut_path = params.get("custom_lut_path", "")

    if nikon_profile == "custom" and custom_lut_path and os.path.isfile(custom_lut_path):
        vf.append(f"lut3d=file='{custom_lut_path}':interp=tetrahedral")
    elif nikon_strength > 0.001 and nikon_profile not in ["", "none"]:
        f = nikon_strength
        if nikon_profile == "nlog_rec709":
            vf.append(f"eq=contrast={1.0 + 0.18 * f:.3f}:saturation={1.0 + 0.22 * f:.3f}:brightness={0.01 * f:.3f}")
        elif nikon_profile == "rich_portrait":
            vf.append(f"eq=contrast={1.0 + 0.08 * f:.3f}:saturation={1.0 + 0.14 * f:.3f}:brightness={0.03 * f:.3f}:gamma={1.0 + 0.08 * f:.3f}")
        elif nikon_profile == "portrait":
            vf.append(f"eq=contrast={1.0 + 0.05 * f:.3f}:saturation={1.0 + 0.10 * f:.3f}:brightness={0.02 * f:.3f}:gamma={1.0 + 0.05 * f:.3f}")
        elif nikon_profile == "vivid":
            vf.append(f"eq=contrast={1.0 + 0.25 * f:.3f}:saturation={1.0 + 0.35 * f:.3f}:brightness=0.000")
        elif nikon_profile == "flat":
            vf.append(f"eq=contrast={1.0 - 0.08 * f:.3f}:saturation={1.0 - 0.06 * f:.3f}:brightness={0.02 * f:.3f}:gamma={1.0 + 0.06 * f:.3f}")
        elif nikon_profile == "monochrome":
            vf.append(f"hue=s={1.0 - f:.3f},eq=contrast={1.0 + 0.28 * f:.3f}:brightness={-0.02 * f:.3f}")
    elif params.get("nlog_normalize", False):
        vf.append("eq=contrast=1.18:saturation=1.22:brightness=0.01")

    # Color, Exposure & Shadow Grading (DaVinci Resolve Style)
    brightness = float(params.get("brightness", 0.0))
    contrast = float(params.get("contrast", 1.0))
    shadows = float(params.get("shadows", 0.0))
    saturation = float(params.get("saturation", 1.0))

    # Shadow lifting via gamma (gamma > 1 lifts dark shadow areas without clipping highlights)
    gamma_val = 1.0 + (shadows * 0.8)
    gamma_val = max(0.5, min(2.5, gamma_val))

    eff_brightness = max(-1.0, min(1.0, brightness))
    eff_contrast = max(0.2, min(2.5, contrast))
    eff_sat = max(0.0, min(3.0, saturation))

    if (abs(eff_brightness) > 0.001 or abs(eff_contrast - 1.0) > 0.001 or abs(gamma_val - 1.0) > 0.001 or abs(eff_sat - 1.0) > 0.001):
        vf.append(f"eq=brightness={eff_brightness:.3f}:contrast={eff_contrast:.3f}:saturation={eff_sat:.3f}:gamma={gamma_val:.3f}")

    def execute_ffmpeg(enc_codec):
        cmd = [
            FFMPEG_BIN, "-y", "-i", src,
            "-c:v", enc_codec, "-b:v", bitrate,
            "-pix_fmt", "yuv420p",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709",
            "-movflags", "+faststart", "-progress", "pipe:1", "-nostats"
        ]
        if enc_codec == "libx264":
            cmd.extend(["-preset", "ultrafast"])
        if vf:
            cmd.extend(["-vf", ",".join(vf)])

        export_audio = params.get("export_audio", True)
        if has_audio and export_audio:
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
        execute_ffmpeg("libx264")

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
    codec = get_best_encoder(FFMPEG_BIN)

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
    # Auto scan user's folder if exists (Priority: 2,145 clips shoot folder)
    mass_dir = "/Users/siamratchongtong/Desktop/STD_VT/081169/100NC_Z8"
    default_dir = "/Users/siamratchongtong/Desktop/STD_VT/100NC_Z8"
    if os.path.exists(mass_dir):
        scan_files([mass_dir])
    elif os.path.exists(default_dir):
        scan_files([default_dir])

    server = ThreadingHTTPServer(("127.0.0.1", PORT), StudioHandler)
    print(f"TurboCompress Studio Server running on http://127.0.0.1:{PORT}")
    server.serve_forever()

if __name__ == "__main__":
    main()
