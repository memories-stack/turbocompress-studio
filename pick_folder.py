#!/usr/bin/env python3
import sys
import tkinter as tk
from tkinter import filedialog

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
root.lift()
root.focus_force()

folder = filedialog.askdirectory(title="Select Video Folder / เลือกโฟลเดอร์วิดีโอ")
root.destroy()

if folder:
    print(folder)
