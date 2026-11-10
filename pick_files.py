#!/usr/bin/env python3
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
root.lift()
root.focus_force()

files = filedialog.askopenfilenames(
    title="Select Video Files / เลือกไฟล์วิดีโอ",
    filetypes=[("Video Files", "*.mp4 *.mov *.m4v *.mkv *.avi *.mts *.m2ts *.braw")]
)
root.destroy()

for f in files:
    print(f)
