# 360° 全景图查看器 — 设计文档

**日期**：2026-06-25
**项目**：`vr-show/`

## 目的

一个桌面浏览器用的 360° 全景图查看器。用户拖入或选择一张 2:1 等距柱状投影全景图后，可以在浏览器内自由旋转视角、滚轮缩放查看。

## 范围

**包含**
- 桌面浏览器，鼠标拖动 + 滚轮交互
- 拖拽 / 文件选择两种方式加载图片
- 初始自动旋转，首次交互后停止
- 深色沉浸式 UI

**不包含（YAGNI）**
- 手机陀螺仪 / 触屏控制
- WebXR / VR 头显 / Cardboard 分屏
- 多图库 / 缩略图 / 上传历史
- 服务端、用户系统、分享
- 截图导出、标注、测距

## 技术栈

- **Vite 5+** — 构建 / dev server
- **Three.js r170+** — WebGL 渲染
- **原生 JavaScript**（ESM）— 无 UI 框架
- **原生 CSS** — 暗色主题，无预处理器

## 架构

UI 状态机最简（`Viewer` 始终运行渲染循环，无图时黑屏）：

```
[Empty: EmptyState 可见] --load image--> [Viewing: EmptyState 隐藏]
                                                    |
                       +-----load new image---------+
```

新图加载时 `Viewer.dispose()` 旧资源后重建纹理。

**启动检测**：`main.js` 创建 `Viewer` 前先 `canvas.getContext('webgl2') || canvas.getContext('webgl')`；失败则隐藏 EmptyState，显示降级提示「请用支持 WebGL 的现代浏览器」。

## 目录结构

```
vr-show/
├── index.html
├── package.json
├── vite.config.js
├── TESTING.md
└── src/
    ├── main.js           # 入口：组装 viewer + UI
    ├── viewer.js         # Three.js 场景 / 相机 / 控制
    ├── fileLoader.js     # 拖拽 + file input → 加载图片
    ├── emptyState.js     # 空状态（居中提示 + drop 区）
    ├── hud.js            # 操作提示（自动隐藏）
    ├── errorBanner.js    # 顶部错误提示条
    └── style.css         # 深色主题
```

## 模块设计

### `Viewer`（`src/viewer.js`）

Three.js 场景封装。

**内部状态**
- `THREE.Scene`、`THREE.PerspectiveCamera`（位于原点，FOV 75°，near 0.1，far 1100）
- `THREE.WebGLRenderer` 挂到 `#viewer-canvas`
- 当前 `THREE.Mesh`（球体，半径 500，60+ 分段，`side: THREE.BackSide`，`EquirectangularReflectionMapping`）
- yaw / pitch（弧度）；FOV（度）
- `isAutoRotating`（布尔）
- `dragState`（{active, lastX, lastY}）

**公开方法**
- `loadTexture(image: HTMLImageElement)` — 加载 / 替换纹理，dispose 旧资源
- `dispose()` — 释放当前 texture 和 material
- `update(dt: number)` — 每帧调用，处理自动旋转和 FOV 平滑插值
- `setAutoRotate(enabled: boolean)` — 切换自动旋转
- `on(event, handler)` — 事件订阅：`firstInteraction`

**渲染循环**
- `requestAnimationFrame` 驱动；`update(dt)` 然后 `renderer.render(scene, camera)`
- 启动时 `setAutoRotate(true)`，首帧渲染前黑屏（无纹理）

**鼠标拖动**（自定义控制，不用 OrbitControls）
- `pointerdown`：记录 `lastX/Y`，设 `cursor: grabbing`
- `pointermove`：`yaw -= dx * 0.0035`、`pitch -= dy * 0.0035`，夹在 `[-π/2 + 0.01, π/2 - 0.01]`
- `pointerup` / `pointercancel`：恢复 `cursor: grab`、触发 `firstInteraction` 事件
- 灵敏度 0.0035 rad/像素（≈ 0.2°/像素）

**滚轮缩放**
- `wheel` 监听器 `passive: false`，`event.preventDefault()`
- 目标 FOV ±3°/事件，夹在 [30°, 100°]
- 当前 FOV 通过 `lerp(currentFOV, targetFOV, 0.1)` 平滑插值
- 向下滚 → FOV 增大 → 视野更广（拉远）
- 任何 wheel 事件触发 `firstInteraction`

**窗口缩放**
- `window.resize` → 更新 `camera.aspect` + `renderer.setSize(window.innerWidth, window.innerHeight)`

### `FileLoader`（`src/fileLoader.js`）

**输入**：
- 隐藏的 `<input type="file" accept="image/*">`（点击 EmptyState 触发）
- 整个 `window` 上的 `dragover` / `dragleave` / `drop` 事件

**校验**：
- `file.type.startsWith('image/')` 通过 → 继续；否则 `onError('not-image')`
- 加载为 `Image` 后失败（`onerror`）→ `onError('load-failed')`
- 图片加载成功后检查 `img.width / img.height` 比例；不是 2:1 时 `console.warn`，不阻止加载

**回调**：
- `onImageLoaded(image: HTMLImageElement)`
- `onError(reason: 'not-image' | 'load-failed')`
- `onDragStateChange(active: boolean)` — dragover/dragleave 时触发，由 `main.js` 转发给 `EmptyState.setDragActive`

**副作用**：
- `dragover` 时 `preventDefault`（阻止浏览器默认行为——直接打开图片）
- 拖入时 `dataTransfer.files[0]`

### `EmptyState`（`src/emptyState.js`）

纯视觉层。实际的拖拽事件由 `FileLoader` 监听 `window`，`EmptyState` 只负责：

- 显示中央文案「拖入一张全景图 / 点击选择文件」
- 点击中央区域 → 调用构造时传入的回调（通常是触发 file input click）
- 提供 `setDragActive(bool)` 方法，由 `main.js` 在收到 `FileLoader` 的 drag 状态变化时调用，给中央容器加高亮边框作为视觉反馈
- `hide()` 调用后 0.3s 淡出（CSS transition）

### `HUD`（`src/hud.js`）

- 底部居中小提示「拖动旋转 · 滚轮缩放」
- `show()` 时 `opacity: 1`，`hide()` 时 `opacity: 0` + `pointer-events: none`
- 加载图片后启动 3 秒定时器自动隐藏
- 任何 `firstInteraction` 事件立即隐藏

### `ErrorBanner`（`src/errorBanner.js`）

- 顶部居中红条（`#e5484d` 背景，白字）
- `show(message, duration = 3000)` — 显示并自动消失
- 同时只显示一条；新消息替换旧消息并重置定时器
- 错误文案：
  - `not-image` → 「请拖入图片文件」
  - `load-failed` → 「图片加载失败」

### `main.js`（入口）

负责把所有模块拼起来：

```js
const viewer = new Viewer('#viewer-canvas')
const emptyState = new EmptyState('#empty-state', () => fileInput.click())
const hud = new HUD('#hud')
const errorBanner = new ErrorBanner('#error-banner')
const fileLoader = new FileLoader(fileInput, window)

fileLoader.onImageLoaded = (img) => {
  viewer.loadTexture(img)
  emptyState.hide()
  hud.show()
  // HUD 自身处理定时器和 firstInteraction
}
fileLoader.onError = (reason) => errorBanner.show(reason)
fileLoader.onDragStateChange = (active) => emptyState.setDragActive(active)
viewer.on('firstInteraction', () => {
  viewer.setAutoRotate(false)
  hud.hide()
})
```

启动循环在 `viewer.js` 内部处理，`main.js` 不直接驱动 RAF。

## 视觉

- **背景**：`#0a0a0a`
- **文字主色**：`#e0e0e0`
- **文字次要**：`#888`
- **强调 / 边框**：`#2a2a2a`
- **错误红**：`#e5484d`
- **字体**：系统默认 sans-serif
- **HUD/ErrorBanner**：半透明 + `backdrop-filter: blur(8px)`
- **过渡**：`opacity 0.3-0.4s ease`

## 测试

`TESTING.md` 列出 10 个手动测试场景：

1. 启动显示空状态
2. 拖入图片能正常显示
3. 拖动鼠标旋转视角（水平、垂直都试）
4. 滚轮缩放，向上 / 向下都试
5. 自动旋转；首次交互后停止
6. HUD 显示约 3 秒后淡出
7. 拖入第二张图正常切换，旧图不残留
8. 拖入非图片（PDF / 文本）触发错误提示
9. 窗口缩放不变形
10. 拖入非 2:1 比例图片能加载，console 有 warn

可选：给 `fileLoader.js` 的 MIME 过滤逻辑加 1 个 Vitest 单测。

## 风险 / 注意点

- **极点接缝**：用 `EquirectangularReflectionMapping` 配合高段数球体（60+），肉眼无感
- **大图显存**：50MB 内的图都安全；超大图浏览器自身可能失败，不做客户端硬限制
- **拖入触发浏览器默认行为**：必须 `dragover` 时 `preventDefault`，否则浏览器直接打开图片而不是 drop 到页面
- **多次加载泄漏**：`loadTexture` 必须 `dispose()` 旧 `texture` 和 `material`，否则显存增长
