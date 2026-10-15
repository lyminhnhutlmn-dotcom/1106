# Tách nhân vật khỏi background bằng LTX‑2.5 Alpha Gen

`ltx_alpha_gen.py` nhận một clip, tạo **alpha matte** bằng LTX‑2.5 Alpha Gen (IC‑LoRA, Beta) rồi dùng ffmpeg ghép ra các định dạng dùng được ngay trong Premiere / Resolve / After Effects.

Alpha Gen hiện **chỉ có open weights** (chưa có endpoint trên API `api.ltx.io`), nên tool hỗ trợ 3 backend:

| `--backend` | Chạy ở đâu | Yêu cầu |
|---|---|---|
| `space` (mặc định) | Hugging Face Space `hugging-apps/ltx-2-5-alpha-matte` (ZeroGPU) | `pip install gradio_client`; nên đặt `HF_TOKEN` để có quota GPU. Matte tối đa 1280×720, 145 frame. |
| `local` | GPU của bạn (H100/B200 cho 1080p) qua `ltx_pipelines.ic_lora` | Repo [LTX‑2](https://github.com/Lightricks/LTX-2) + weights `ltx-2.5-22b-ic-lora-alpha-gen-0.9.safetensors` trong `--models-dir`. Tool chuẩn bị clip (pad /32, cắt `8n+1` frame) và sinh lệnh chạy; thêm `--run` để chạy luôn. |
| `none` | Không tạo matte | Dùng `--matte <file>` có sẵn (ví dụ xuất từ ComfyUI). |

## Dùng nhanh

```bash
pip install gradio_client            # chỉ cần cho --backend space
export HF_TOKEN=hf_xxx               # khuyến nghị

python tools/ltx-alpha-gen/ltx_alpha_gen.py \
  --input clip.mov \
  --out-dir ltx_alpha_out \
  --background new_bg.jpg            # tuỳ chọn: ảnh hoặc video nền mới
```

Kết quả trong `--out-dir` (đúng độ phân giải gốc, giữ audio):

- `<name>_matte.mp4` — matte trắng/đen (trắng = nhân vật)
- `<name>_green.mp4` — nhân vật trên phông xanh `#00B140`
- `<name>_alpha.mov` — ProRes 4444 có kênh alpha (dựng phim)
- `<name>_alpha.webm` — VP9 có alpha (web)
- `<name>_checker.mp4` — preview trên nền caro
- `<name>_bg.mp4` — ghép lên nền mới (khi có `--background`)

Tuỳ chọn tinh chỉnh viền: `--edge-shrink N` (co matte N px để bỏ viền phông), `--edge-soft SIGMA` (làm mềm mép), `--seed`.

## Giới hạn

- Số frame bị cắt về dạng `8n+1` (≤121): clip 100 frame → 97 frame.
- Backend `space` tạo matte ở 1280×704 rồi upscale về kích thước gốc; cần GPU cục bộ (`--backend local`) để matte full 1080p.
- Alpha Gen tự quyết định "nhân vật" theo ngữ nghĩa; đạo cụ (vd. dải vải) có thể không được giữ.
