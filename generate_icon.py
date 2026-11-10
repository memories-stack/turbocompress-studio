#!/usr/bin/env python3
import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

SIZE = 1024

# 1. Base squircle path (macOS standard)
pad = 80
w = SIZE - 2 * pad
radius = 195

# Background gradient: Deep DaVinci Dark Charcoal/Obsidian
bg = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bg_draw = ImageDraw.Draw(bg)

# Mask for squircle
mask = Image.new("L", (SIZE, SIZE), 0)
mask_draw = ImageDraw.Draw(mask)
mask_draw.rounded_rectangle([pad, pad, pad + w, pad + w], radius=radius, fill=255)

# Rich dark gradient
for y in range(pad, pad + w):
    t = (y - pad) / float(w)
    # Slate black to deep studio carbon
    r = int(14 * (1 - t) + 26 * t)
    g = int(16 * (1 - t) + 29 * t)
    b = int(22 * (1 - t) + 40 * t)
    bg_draw.line([(pad, y), (pad + w, y)], fill=(r, g, b, 255))

# Subtle radial cyan glow behind the sensor
glow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
glow_draw = ImageDraw.Draw(glow)
center_x, center_y = SIZE // 2, SIZE // 2
glow_draw.ellipse([center_x - 300, center_y - 300, center_x + 300, center_y + 300], fill=(0, 180, 255, 35))
glow_draw.ellipse([center_x - 180, center_y - 180, center_x + 180, center_y + 180], fill=(230, 57, 70, 30))
glow = glow.filter(ImageFilter.GaussianBlur(80))

base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
base.paste(bg, (0, 0), mask)
base = Image.alpha_composite(base, glow)

# Apply mask again to keep squircle clean
final_base = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
final_base.paste(base, (0, 0), mask)

# Inner metallic bevel
b_draw = ImageDraw.Draw(final_base)
b_draw.rounded_rectangle([pad + 3, pad + 3, pad + w - 3, pad + w - 3], radius=radius - 3, outline=(55, 62, 85, 200), width=3)
b_draw.rounded_rectangle([pad + 1, pad + 1, pad + w - 1, pad + w - 1], radius=radius, outline=(20, 22, 30, 255), width=2)

# Shadow under squircle
shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
s_draw = ImageDraw.Draw(shadow)
s_draw.rounded_rectangle([pad, pad + 20, pad + w, pad + w + 20], radius=radius, fill=(0, 0, 0, 180))
shadow = shadow.filter(ImageFilter.GaussianBlur(30))

final_canvas = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
final_canvas.paste(shadow, (0, 0))
final_canvas.paste(final_base, (0, 0), mask)

# 2. Main Icon Feature: Vertical 9:16 Cinema Canvas
screen_w = 280
screen_h = int(screen_w * 16 / 9) # ~498px
sx1 = center_x - screen_w // 2
sy1 = center_y - screen_h // 2 - 15
sx2 = sx1 + screen_w
sy2 = sy1 + screen_h

# Screen drop shadow
ss = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
ss_draw = ImageDraw.Draw(ss)
ss_draw.rounded_rectangle([sx1 - 10, sy1 - 5, sx2 + 10, sy2 + 15], radius=28, fill=(0, 0, 0, 220))
ss = ss.filter(ImageFilter.GaussianBlur(25))
final_canvas.paste(ss, (0, 0), ss)

# 3. Vertical Screen Body (Matte Black with Cyan/Orange Accent)
screen = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
sc_draw = ImageDraw.Draw(screen)

# Screen interior with subtle vertical gradient
for sy in range(sy1, sy2):
    t = (sy - sy1) / float(screen_h)
    r = int(12 * (1 - t) + 18 * t)
    g = int(14 * (1 - t) + 20 * t)
    b = int(20 * (1 - t) + 30 * t)
    sc_draw.line([(sx1, sy), (sx2, sy)], fill=(r, g, b, 255))

# Mask screen to rounded rectangle
s_mask = Image.new("L", (SIZE, SIZE), 0)
sm_draw = ImageDraw.Draw(s_mask)
sm_draw.rounded_rectangle([sx1, sy1, sx2, sy2], radius=24, fill=255)

screen_final = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
screen_final.paste(screen, (0, 0), s_mask)

# Screen Border: Vibrant Cyan Glow
sb_draw = ImageDraw.Draw(screen_final)
sb_draw.rounded_rectangle([sx1, sy1, sx2, sy2], radius=24, outline=(0, 229, 255, 255), width=7)
sb_draw.rounded_rectangle([sx1 + 4, sy1 + 4, sx2 - 4, sy2 - 4], radius=20, outline=(0, 150, 200, 100), width=2)

# DaVinci Film Track Perforations on edges
for py in range(sy1 + 35, sy2 - 35, 32):
    sb_draw.rounded_rectangle([sx1 + 10, py, sx1 + 20, py + 18], radius=4, fill=(40, 46, 62, 255))
    sb_draw.rounded_rectangle([sx2 - 20, py, sx2 - 10, py + 18], radius=4, fill=(40, 46, 62, 255))

# DaVinci Studio Focus / Crop Reticle (Bright Red Corners)
clen = 28
c_color = (230, 57, 70, 255)
# Top-Left
sb_draw.line([(sx1 + 30, sy1 + 30), (sx1 + 30 + clen, sy1 + 30)], fill=c_color, width=5)
sb_draw.line([(sx1 + 30, sy1 + 30), (sx1 + 30, sy1 + 30 + clen)], fill=c_color, width=5)
# Top-Right
sb_draw.line([(sx2 - 30, sy1 + 30), (sx2 - 30 - clen, sy1 + 30)], fill=c_color, width=5)
sb_draw.line([(sx2 - 30, sy1 + 30), (sx2 - 30, sy1 + 30 + clen)], fill=c_color, width=5)
# Bottom-Left
sb_draw.line([(sx1 + 30, sy2 - 30), (sx1 + 30 + clen, sy2 - 30)], fill=c_color, width=5)
sb_draw.line([(sx1 + 30, sy2 - 30), (sx1 + 30, sy2 - 30 - clen)], fill=c_color, width=5)
# Bottom-Right
sb_draw.line([(sx2 - 30, sy2 - 30), (sx2 - 30 - clen, sy2 - 30)], fill=c_color, width=5)
sb_draw.line([(sx2 - 30, sy2 - 30), (sx2 - 30, sy2 - 30 - clen)], fill=c_color, width=5)

final_canvas = Image.alpha_composite(final_canvas, screen_final)

# 4. Dynamic Glowing Rotation Ring (90° / 270° CCW Vertical Flip Arrow)
ring = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
r_draw = ImageDraw.Draw(ring)
arc_r = 245
arc_box = [center_x - arc_r, center_y - arc_r - 15, center_x + arc_r, center_y + arc_r - 15]

# Glowing cyan arc with arrowhead
r_draw.arc(arc_box, start=125, end=355, fill=(0, 229, 255, 255), width=14)

# Glow around the arc
ring_glow = ring.filter(ImageFilter.GaussianBlur(8))
final_canvas = Image.alpha_composite(final_canvas, ring_glow)

# Arrowhead at 125° (Counter-clockwise rotation direction)
arrow_rad = math.radians(125)
tip_x = center_x + int(arc_r * math.cos(arrow_rad))
tip_y = (center_y - 15) + int(arc_r * math.sin(arrow_rad))

pts = [
    (tip_x - 5, tip_y + 5),
    (tip_x + 36, tip_y - 10),
    (tip_x + 18, tip_y + 36)
]
arrow_layer = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
al_draw = ImageDraw.Draw(arrow_layer)
al_draw.polygon(pts, fill=(0, 229, 255, 255))
final_canvas = Image.alpha_composite(final_canvas, ring)
final_canvas = Image.alpha_composite(final_canvas, arrow_layer)

# 5. Golden Turbo Lightning Bolt (Speed / VideoToolbox M-Series & NVENC)
bolt = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
b_draw = ImageDraw.Draw(bolt)

cy_offset = -15
bolt_pts = [
    (center_x + 22, center_y - 145 + cy_offset),
    (center_x - 75, center_y + 10 + cy_offset),
    (center_x - 8, center_y + 10 + cy_offset),
    (center_x - 30, center_y + 155 + cy_offset),
    (center_x + 80, center_y - 10 + cy_offset),
    (center_x + 12, center_y - 10 + cy_offset),
]

# Bolt shadow
b_shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bs_draw = ImageDraw.Draw(b_shadow)
bs_draw.polygon([(x + 4, y + 10) for x, y in bolt_pts], fill=(0, 0, 0, 200))
b_shadow = b_shadow.filter(ImageFilter.GaussianBlur(14))
final_canvas = Image.alpha_composite(final_canvas, b_shadow)

# Bolt primary fill: Vibrant Golden Orange
b_draw.polygon(bolt_pts, fill=(255, 175, 0, 255), outline=(255, 235, 120, 255), width=4)

# Bolt core highlight: Bright Yellow
inner_bolt_pts = [
    (center_x + 16, center_y - 110 + cy_offset),
    (center_x - 52, center_y + 6 + cy_offset),
    (center_x - 2, center_y + 6 + cy_offset),
    (center_x - 18, center_y + 120 + cy_offset),
    (center_x + 60, center_y - 8 + cy_offset),
    (center_x + 10, center_y - 8 + cy_offset),
]
b_draw.polygon(inner_bolt_pts, fill=(255, 235, 80, 230))
final_canvas = Image.alpha_composite(final_canvas, bolt)

# 6. Bottom Professional Badge: "9:16 TURBO"
badge_w = 320
badge_h = 48
bx1 = center_x - badge_w // 2
by1 = pad + w - 100
bx2 = bx1 + badge_w
by2 = by1 + badge_h

badge = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
bg_badge = ImageDraw.Draw(badge)
bg_badge.rounded_rectangle([bx1, by1, bx2, by2], radius=14, fill=(16, 18, 26, 240), outline=(0, 229, 255, 200), width=3)

try:
    font = ImageFont.truetype("/System/Library/Fonts/SFCompact.ttf", 22)
except:
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 22)
    except:
        font = ImageFont.load_default()

badge_text = "9:16 TURBO STUDIO"
bbox = bg_badge.textbbox((0, 0), badge_text, font=font)
tw = bbox[2] - bbox[0]
th = bbox[3] - bbox[1]
tx = center_x - tw // 2
ty = by1 + (badge_h - th) // 2 - 2
bg_badge.text((tx, ty), badge_text, font=font, fill=(0, 229, 255, 255))

final_canvas = Image.alpha_composite(final_canvas, badge)

out_path = "/Users/siamratchongtong/Downloads/Recode/TurboCompress/AppIcon_1024.png"
final_canvas.save(out_path, "PNG")
print("Saved cinematic 1024x1024 App Icon to", out_path)
