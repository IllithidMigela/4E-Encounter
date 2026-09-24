import { useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { useTheme } from "../ThemeProvider";
import { readFileAsDataUrl, cropImage } from "../lib/image";
import { Slider } from "../components/md";
import { shouldWarnOversize, prepareImageForStore, IMAGE_SIZE_HINT } from "../lib/settings";

export default function PortraitFrame() {
  const { portraitCropped, setPortrait } = useTheme();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pixels, setPixels] = useState<Area | null>(null);
  const [oversize, setOversize] = useState<File | null>(null);

  async function loadPending(f: File, compress: boolean) {
    const url = await readFileAsDataUrl(f);
    const ready = compress ? await prepareImageForStore(url) : url;
    setPending(ready);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setPixels(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    e.target.value = "";
    // 图片过大：提醒用户选择「取消 / 由网站自动压缩」后再继续
    if (shouldWarnOversize(f.size)) {
      setOversize(f);
      return;
    }
    await loadPending(f, false);
  }

  async function confirm() {
    if (!pending || !pixels) return;
    const cropped = await cropImage(pending, pixels);
    await setPortrait(pending, cropped);
    setPending(null);
  }

  return (
    <>
      <div className="portrait-frame" onClick={() => fileRef.current?.click()} title={portraitCropped ? "点击更换立绘" : "点击上传立绘"}>
        <input ref={fileRef} type="file" accept="image/*" onChange={onFile} style={{ display: "none" }} />
        {portraitCropped ? (
          <img className="portrait-img" src={portraitCropped} alt="角色立绘" />
        ) : (
          <div className="portrait-placeholder">
            <span className="material-symbols-outlined">add_photo_alternate</span>
            <span>上传立绘</span>
          </div>
        )}
      </div>
      {oversize && createPortal(
        <div className="crop-overlay" onClick={() => setOversize(null)}>
          <div className="crop-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crop-dialog-body">
              <p className="crop-dialog-title">图片过大（{Math.ceil(oversize.size / 1024)} KB）</p>
              <p className="hint">为节省本地存储空间，立绘图片建议小于 {Math.ceil(IMAGE_SIZE_HINT / 1024)} KB。请选择：</p>
            </div>
            <div className="crop-controls">
              <button type="button" className="crop-btn" onClick={() => setOversize(null)}>取消，自行压缩上传</button>
              <button type="button" className="crop-btn primary" onClick={() => { const f = oversize; setOversize(null); void loadPending(f, true); }}>自动压缩</button>
            </div>
          </div>
        </div>,
        document.body
      )}
      {pending && createPortal(
        <div className="crop-overlay" onClick={() => setPending(null)}>
          <div className="crop-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="crop-area">
              <Cropper
                image={pending}
                crop={crop}
                zoom={zoom}
                aspect={3 / 4}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, areaPixels) => setPixels(areaPixels)}
              />
            </div>
            <div className="crop-controls">
              <Slider min={1} max={3} step={0.01} value={zoom} onInput={(e) => setZoom((e.target as any).value)} />
              <button type="button" className="crop-btn" onClick={() => setPending(null)}>取消</button>
              <button type="button" className="crop-btn primary" onClick={() => void confirm()}>确认</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
