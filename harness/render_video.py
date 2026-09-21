"""Turn recorded frames into an mp4 with a slim title bar. Usage: python harness/render_video.py <dir> "<title>" [fps]"""
import sys, subprocess, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
d = Path(sys.argv[1]); title = sys.argv[2]; fps = int(sys.argv[3]) if len(sys.argv) > 3 else 24
frames = sorted((int(p.stem), p) for p in (d / "frames").glob("*.jpg"))
end = frames[-1][0] + 400
out = d / "render"; shutil.rmtree(out, ignore_errors=True); out.mkdir()
W, H, TOP = 1440, 900 + 72, 72
f_t = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 22); f_s = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 15)
i = 0; n = 0; cur = None
for t in range(0, end, int(1000 / fps)):
    while i + 1 < len(frames) and frames[i + 1][0] <= t: i += 1
    if cur is None or cur[0] != i:
        im = Image.open(frames[i][1]).convert("RGB")
        if im.size != (1440, 900): im = im.resize((1440, 900), Image.LANCZOS)
        cur = (i, im)
    img = Image.new("RGB", (W, H), "#0e1113"); img.paste(cur[1], (0, TOP)); dr = ImageDraw.Draw(img)
    dr.text((20, 12), title, font=f_t, fill="#e4e8eb")
    legend = "READ = green border    MAYBE = amber    SKIP = dimmed    ·    each badge is one Jev decision, about 300 ms, no scripted rules"
    dr.text((20, 44), legend, font=f_s, fill="#97a3ab")
    dr.text((W - 20, 44), f"{t/1000:5.1f} s  real time", font=f_s, fill="#97a3ab", anchor="ra")
    img.save(out / f"{n:06d}.jpg", quality=90); n += 1
mp4 = d / (d.name + ".mp4")
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(fps), "-i", str(out / "%06d.jpg"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", "-movflags", "+faststart", str(mp4)], check=True)
print("frames", n, "->", mp4, round(mp4.stat().st_size / 1e6, 1), "MB")
