#!/usr/bin/env python3
"""
ANNAHOUSESTUDIO — Tách nhân vật khỏi background bằng LTX-2.5 Alpha Gen (IC-LoRA).

LTX-2.5 Alpha Gen nhận video RGB và sinh alpha matte (trắng = nhân vật, đen = nền),
khớp từng frame, không cần phông xanh / mask / prompt. Model tự chọn chủ thể chính.
Docs: https://docs.ltx.io/open-source-model/vfx-post-production/alpha-gen
Model: https://huggingface.co/Lightricks/LTX-2.5-22b-IC-LoRA-Alpha-Gen

Hai cách chạy model (--backend):
  space  : gọi HF Space ZeroGPU public (hugging-apps/ltx-2-5-alpha-matte) — không cần GPU,
           output tối đa 1280x720 / 145 frames. Cần `pip install gradio_client`.
           Đặt HF_TOKEN để có quota ZeroGPU cao hơn.
  local  : chạy `python -m ltx_pipelines.ic_lora` trên máy có GPU (H100/B200 cho 1080p).
           Script tự chuẩn hoá video (pad chia hết 32, số frame 8n+1 ≤ 121) và in/chạy lệnh.
  none   : bỏ qua bước model, chỉ composite với matte có sẵn (--matte).

Sau khi có matte, script composite bằng ffmpeg về đúng độ phân giải nguồn:
  <name>_matte.mp4        alpha matte (grayscale)
  <name>_green.mp4        nhân vật trên phông xanh
  <name>_alpha.mov        ProRes 4444 có kênh alpha (Premiere / Resolve / After Effects)
  <name>_alpha.webm       VP9 có alpha (web)
  <name>_checker.mp4      preview trên nền ca-rô
  <name>_bg.mp4           (tuỳ chọn) ghép lên --background ảnh/video

Ví dụ:
  python3 ltx_alpha_gen.py --input clip.mov --out-dir out/
  python3 ltx_alpha_gen.py --input clip.mov --backend local --models-dir ~/models/ltx-2.5 --run
  python3 ltx_alpha_gen.py --input clip.mov --backend none --matte matte.mp4 --background bg.jpg
"""
import argparse
import json
import os
import shlex
import shutil
import subprocess
import sys
import time

SPACE_DEFAULT = "hugging-apps/ltx-2-5-alpha-matte"
GREEN = "0x00B140"
MODEL_FILES = {
    "transformer": "ltx-2.5-22b-distilled-transformer-bf16.safetensors",
    "text_encoder": "gemma4-12b-with-proj-ltx-2.5-bf16.safetensors",
    "video_vae": "ltx-2.5-video-vae-bf16.safetensors",
    "audio_vae": "ltx-2.5-audio-vae-bf16.safetensors",
    "upscaler": "ltx-2.5-latent-spatial-upscaler-x2-bf16-1.0.safetensors",
    "lora": "ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors",
}


def log(msg):
    print(f"[ltx-alpha] {msg}", flush=True)


def run(cmd, check=True, capture=False):
    log("$ " + " ".join(shlex.quote(c) for c in cmd))
    return subprocess.run(cmd, check=check, text=True, capture_output=capture)


def need(binary):
    if not shutil.which(binary):
        sys.exit(f"Thiếu `{binary}` trong PATH.")


def probe(path):
    out = run([
        "ffprobe", "-v", "error", "-select_streams", "v:0",
        "-count_frames", "-show_entries",
        "stream=width,height,r_frame_rate,nb_read_frames,duration",
        "-show_entries", "format=duration", "-of", "json", path,
    ], capture=True).stdout
    j = json.loads(out)
    s = j["streams"][0]
    num, den = s["r_frame_rate"].split("/")
    fps = float(num) / float(den or 1)
    frames = int(s.get("nb_read_frames") or 0)
    dur = float(s.get("duration") or j["format"].get("duration") or 0)
    if not frames and dur:
        frames = int(round(dur * fps))
    has_audio = bool(json.loads(run([
        "ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "json", path
    ], capture=True).stdout).get("streams"))
    return {"width": int(s["width"]), "height": int(s["height"]), "fps": fps, "frames": frames, "audio": has_audio}


def snap_8n1(n, cap=121):
    n = min(int(n), cap)
    return max(9, (n - 1) // 8 * 8 + 1)


def pad32(x):
    return (x + 31) // 32 * 32


# ---------------------------------------------------------------- backends
def backend_space(args, src):
    try:
        from gradio_client import Client, handle_file
    except ImportError:
        sys.exit("Cần `pip install gradio_client` để dùng --backend space.")
    token = os.environ.get("HF_TOKEN")
    log(f"Kết nối Space {args.space}" + (" (có HF_TOKEN)" if token else " (ẩn danh — quota ZeroGPU thấp)"))
    client = Client(args.space, **({"token": token} if token else {}))
    t0 = time.time()
    job = client.submit(video_path=handle_file(src), seed=args.seed, randomize_seed=False, api_name="/generate_matte")
    last = None
    while not job.done():
        st = job.status()
        desc = st.progress_data[0].desc if st.progress_data else None
        key = (getattr(st.code, "name", str(st.code)), st.rank, desc)
        if key != last:
            extra = f" · hàng đợi #{st.rank}" if st.rank is not None else ""
            log(f"{int(time.time() - t0):4d}s {key[0]}{extra}{' · ' + desc if desc else ''}")
            last = key
        time.sleep(2)
    try:
        green, matte, seed, info = job.result()
    except Exception as e:  # noqa: BLE001 — gradio AppError / quota / timeout
        msg = str(e)
        if "ZeroGPU quota" in msg:
            sys.exit(
                "Hết quota ZeroGPU ẩn danh của HF Space.\n"
                f"  → {msg}\n"
                "  → Đặt HF_TOKEN=<token Hugging Face> rồi chạy lại (quota cao hơn), hoặc dùng --backend local trên máy có GPU,\n"
                "    hoặc chạy thủ công trên https://huggingface.co/spaces/" + args.space + " rồi dùng --backend none --matte <matte.mp4>."
            )
        sys.exit(f"Space lỗi: {msg}")
    pth = lambda x: x["video"] if isinstance(x, dict) else x  # noqa: E731
    out_matte = os.path.join(args.out_dir, f"{args.name}_matte_space.mp4")
    shutil.copy(pth(matte), out_matte)
    log(f"Space xong sau {int(time.time() - t0)}s · seed {seed} · {info}")
    return out_matte


def backend_local(args, src, info):
    """Chuẩn hoá video cho ltx_pipelines rồi in (hoặc chạy) lệnh IC-LoRA Alpha Gen."""
    W, H = pad32(info["width"]), pad32(info["height"])
    n = snap_8n1(info["frames"], cap=121)
    if W > 1920 or H > 1088:
        sys.exit(f"Nguồn {info['width']}x{info['height']} vượt giới hạn 1920x1088 của Alpha Gen — hãy scale nhỏ trước.")
    if info["frames"] > n:
        log(f"Clip có {info['frames']} frames > {n} (8n+1 ≤ 121) → chỉ xử lý {n} frame đầu; cắt clip dài thành nhiều đoạn.")
    prep = os.path.join(args.out_dir, f"{args.name}_prep_{W}x{H}_{n}f.mp4")
    vf = f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,format=yuv420p"
    run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-vf", vf, "-frames:v", str(n), "-an",
         "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", prep])
    m = lambda k: os.path.join(args.models_dir, MODEL_FILES[k])  # noqa: E731
    out_matte = os.path.join(args.out_dir, f"{args.name}_matte_local.mp4")
    cmd = [
        sys.executable, "-m", "ltx_pipelines.ic_lora",
        "--transformer-path", m("transformer"),
        "--text-encoder-path", m("text_encoder"),
        "--video-vae-path", m("video_vae"),
        "--audio-vae-path", m("audio_vae"),
        "--spatial-upsampler-path", m("upscaler"),
        "--prompt", "",
        # --skip-stage-2 trả về 1/2 kích thước CLI → truyền gấp đôi để ra đúng độ phân giải nguồn
        "--width", str(W * 2), "--height", str(H * 2),
        "--num-frames", str(n), "--frame-rate", str(int(round(info["fps"]))),
        "--video-conditioning", prep, "1.0",
        "--lora", m("lora"), "1.0",
        "--skip-stage-2", "--seed", str(args.seed),
        "--output-path", out_matte,
    ]
    sh = os.path.join(args.out_dir, f"{args.name}_run_alpha_gen.sh")
    with open(sh, "w") as f:
        f.write("#!/usr/bin/env bash\nset -euo pipefail\n# LTX-2.5 Alpha Gen — sinh ra bởi ANNAHOUSESTUDIO ltx_alpha_gen.py\n")
        f.write(" \\\n  ".join(shlex.quote(c) for c in cmd) + "\n")
    os.chmod(sh, 0o755)
    log(f"Đã chuẩn hoá: {prep} ({W}x{H}, {n} frames). Lệnh model lưu ở {sh}")
    if not args.run:
        log("Chưa chạy model (thêm --run trên máy có GPU). Dùng --backend none --matte <file> để composite sau.")
        return None
    run(cmd)
    return out_matte


# ---------------------------------------------------------------- composite
def matte_filter(info, minfo):
    """Đưa matte về đúng khung nguồn: matte nhỏ hơn → scale-cover + pad; lớn hơn (đã pad /32) → crop giữa."""
    W, H = info["width"], info["height"]
    mw, mh = minfo["width"], minfo["height"]
    if mw >= W and mh >= H:
        return f"crop={W}:{H}:(iw-ow)/2:(ih-oh)/2"
    scale = max(mw / W, mh / H)           # Space dùng center-crop-fit → matte là vùng con của nguồn
    rw, rh = round(mw / scale), round(mh / scale)
    rw, rh = min(rw, W), min(rh, H)
    return f"scale={rw}:{rh}:flags=lanczos,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black"


def composite(args, src, matte, info):
    minfo = probe(matte)
    n = min(info["frames"], minfo["frames"]) if info["frames"] else minfo["frames"]
    fps = info["fps"]
    mf = matte_filter(info, minfo)
    base = os.path.join(args.out_dir, args.name)
    # [m] = matte gray đã khớp khung; [s] = nguồn cắt bằng số frame matte
    # edge-shrink: co biên matte vài px để bớt viền màu nền (spill); edge-soft: làm mềm biên
    edge = "".join(",erosion" for _ in range(max(0, args.edge_shrink)))
    if args.edge_soft > 0:
        edge += f",gblur=sigma={args.edge_soft}"
    matte_chain = f"[1:v]{mf},format=gray{edge},trim=end_frame={n},setpts=PTS-STARTPTS[m];"
    src_chain = f"[0:v]trim=end_frame={n},setpts=PTS-STARTPTS,format=rgba[s];"
    common = matte_chain + src_chain
    def audio_args(out):
        if not info["audio"]:
            return ["-an"]
        codec = ["-c:a", "libopus", "-b:a", "128k"] if out.endswith(".webm") else ["-c:a", "aac", "-b:a", "192k"]
        return ["-map", "0:a?", *codec]
    audio = audio_args("x.mp4")
    dur = ["-t", f"{n / fps:.4f}"]
    outputs = {}

    def ff(filter_tail, out, *codec, head=common):
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", matte,
             "-filter_complex", head + filter_tail, "-map", "[out]", *audio_args(out), *dur, *codec, out])
        outputs[os.path.basename(out)] = out

    # 1. matte chuẩn ở độ phân giải nguồn
    ff("[m]format=yuv420p[out]", f"{base}_matte.mp4", "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", head=matte_chain)
    # 2. phông xanh
    ff(f"[s][m]alphamerge[fg];color=c={GREEN}:s={info['width']}x{info['height']}:r={fps}[bg];"
       f"[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[out]",
       f"{base}_green.mp4", "-c:v", "libx264", "-crf", "14", "-pix_fmt", "yuv420p")
    # 3. ProRes 4444 alpha
    ff("[s][m]alphamerge[out]", f"{base}_alpha.mov",
       "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-qscale:v", str(args.prores_q))
    # 4. WebM VP9 alpha
    ff("[s][m]alphamerge,format=yuva420p[out]", f"{base}_alpha.webm",
       "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "24", "-row-mt", "1", "-auto-alt-ref", "0")
    # 5. preview ca-rô
    ff(f"[s][m]alphamerge[fg];color=c=0x8a8a8a:s={info['width']}x{info['height']}:r={fps},"
       f"geq=lum='if(eq(mod(floor(X/48)+floor(Y/48),2),0),150,110)':cb=128:cr=128[bg];"
       f"[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[out]",
       f"{base}_checker.mp4", "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p")
    # 6. ghép nền tuỳ chọn
    if args.background:
        is_img = os.path.splitext(args.background)[1].lower() in (".jpg", ".jpeg", ".png", ".webp", ".bmp")
        bg_in = ["-loop", "1", "-i", args.background] if is_img else ["-stream_loop", "-1", "-i", args.background]
        fc = (common + f"[s][m]alphamerge[fg];[2:v]scale={info['width']}:{info['height']}:force_original_aspect_ratio=increase,"
              f"crop={info['width']}:{info['height']},fps={fps},format=yuv420p[bg];[bg][fg]overlay=format=auto:shortest=1,format=yuv420p[out]")
        out = f"{base}_bg.mp4"
        run(["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-i", matte, *bg_in,
             "-filter_complex", fc, "-map", "[out]", *audio, *dur, "-c:v", "libx264", "-crf", "16", "-pix_fmt", "yuv420p", out])
        outputs[os.path.basename(out)] = out
    return outputs


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", "-i", required=True, help="video RGB nguồn")
    ap.add_argument("--out-dir", "-o", default="ltx_alpha_out")
    ap.add_argument("--name", help="tiền tố file output (mặc định: tên file nguồn)")
    ap.add_argument("--backend", choices=["space", "local", "none"], default="space")
    ap.add_argument("--space", default=SPACE_DEFAULT, help="HF Space id (backend space)")
    ap.add_argument("--models-dir", default=os.environ.get("LTX_MODELS_DIR", "models/ltx-2.5"), help="thư mục .safetensors (backend local)")
    ap.add_argument("--run", action="store_true", help="backend local: chạy model luôn (cần GPU) thay vì chỉ sinh lệnh")
    ap.add_argument("--matte", help="matte có sẵn (backend none)")
    ap.add_argument("--background", help="ảnh/video nền để ghép thêm")
    ap.add_argument("--seed", type=int, default=1234)
    ap.add_argument("--prores-q", type=int, default=9, help="qscale ProRes 4444 (nhỏ = nét/nặng hơn)")
    ap.add_argument("--edge-shrink", type=int, default=1, help="số lần co biên matte (erosion 3x3) để bớt viền màu nền; 0 = tắt")
    ap.add_argument("--edge-soft", type=float, default=0.8, help="độ mềm biên (gblur sigma); 0 = tắt")
    args = ap.parse_args()

    need("ffmpeg"); need("ffprobe")
    src = os.path.abspath(args.input)
    if not os.path.exists(src):
        sys.exit(f"Không thấy file {src}")
    args.name = args.name or os.path.splitext(os.path.basename(src))[0]
    os.makedirs(args.out_dir, exist_ok=True)

    info = probe(src)
    log(f"Nguồn: {info['width']}x{info['height']} · {info['frames']} frames · {info['fps']:g} fps · audio={'có' if info['audio'] else 'không'}")

    if args.backend == "space":
        matte = backend_space(args, src)
    elif args.backend == "local":
        matte = backend_local(args, src, info)
        if not matte:
            return
    else:
        if not args.matte:
            sys.exit("--backend none cần --matte <file>")
        matte = os.path.abspath(args.matte)

    outputs = composite(args, src, matte, info)
    log("Hoàn tất:")
    for k, v in outputs.items():
        log(f"  {k:32s} {os.path.getsize(v) / 1e6:7.2f} MB")


if __name__ == "__main__":
    main()
