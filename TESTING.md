# Manual Testing Checklist

This is a frontend 3D project — most behavior is verified by eye in a real browser. Run through these 10 scenarios after each change to the viewer/UI.

## Setup

1. `npm install` (if not done)
2. `npm run dev` — open http://127.0.0.1:5173/
3. Have at least one equirectangular 2:1 image ready (the bundled `Qwen-Image-2512_00001_.png` works). Have a non-image file (e.g. a `.pdf` or `.txt`) ready for the error test.

## Scenarios

### 1. Empty state on launch
- [ ] Page loads showing "拖入一张全景图 / 或将图片拖到此处 · 点击选择文件" centered on a black background.
- [ ] The empty state border is dashed gray.

### 2. Load image by drop
- [ ] Drag the equirectangular image from your file manager onto the page.
- [ ] Empty state fades out (0.3s).
- [ ] The panorama appears wrapped around the viewer.

### 3. Drag to rotate
- [ ] Click and drag horizontally → camera yaws (no limit on rotation).
- [ ] Click and drag vertically → camera pitches.
- [ ] Drag toward the top → pitch stops at +89° (no flip).
- [ ] Cursor changes to `grabbing` during drag, back to `grab` on release.

### 4. Wheel zoom
- [ ] Scroll up → FOV decreases (zooms in, scene appears closer).
- [ ] Scroll down → FOV increases (zooms out, scene appears farther).
- [ ] FOV clamps at 30° (max zoom-in) and 100° (max zoom-out) — no NaN, no flicker.

### 5. Auto-rotate stops on first interaction
- [ ] After loading the image, the scene slowly rotates on its own.
- [ ] On first pointer-down or wheel event, the rotation stops immediately.

### 6. HUD auto-hide
- [ ] After loading the image, a "拖动旋转 · 滚轮缩放" hint appears at the bottom.
- [ ] It fades out within ~3 seconds (no interaction needed).
- [ ] If the user interacts before 3s, the hint fades immediately.

### 7. Load a second image
- [ ] Drop a different panoramic image after the first.
- [ ] The new image replaces the old one (no flicker, no leftover artifacts).
- [ ] Empty state does NOT reappear; HUD shows again (then fades).
- [ ] Auto-rotate does NOT restart (only fires on first load).

### 8. Non-image file shows error
- [ ] Drop a `.pdf` or `.txt` file.
- [ ] A red banner appears at the top: "请拖入图片文件".
- [ ] The banner disappears after ~3 seconds.
- [ ] Viewer state is unchanged (no crash, no flash).

### 9. Window resize
- [ ] Resize the browser window.
- [ ] Canvas fills the new size, image is not stretched or distorted.

### 10. Non-2:1 image loads with warning
- [ ] Drop a non-panoramic image (e.g. a 4:3 photo).
- [ ] Image still loads and displays (it will look stretched, that's expected).
- [ ] Browser DevTools console shows: `Image aspect ratio is W:H, not 2:1. It will display stretched.`
