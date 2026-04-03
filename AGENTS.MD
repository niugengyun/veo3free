## 项目定位
Veo3Free 是一个桌面端自动化生成工具：后端负责任务队列与输出落盘，前端负责任务创建/管理，浏览器端（`guide/inject.js`）负责在 Google Flow 页面上自动完成提示词输入、模型选择、参考图/首尾帧上传、提交生成、等待完成并把生成结果回传给后端保存。

## 关键目录与入口
- 桌面应用入口：`main.py`
  - 负责日志与输出目录初始化
  - 启动 FastAPI（OpenAI 兼容 API + guide + WebSocket）
  - 启动 pywebview 并加载前端 `web/index.html`（开发/生产模式由 `DEV=1` 和 `web` 目录存在性决定）
- WebSocket 与结果落盘：`server/ws_routes.py`
- API 兼容与模型映射：`api_server_fastapi.py`
- 引导页静态路由：`server/guide_routes.py`
- 版本/更新：`version.py`、`updater.py`
- 前端任务管理：`web-src/src/App.tsx`
- 浏览器自动化脚本：`guide/inject.js`

## 后端（`main.py`）能力
1. 任务队列管理（`TaskManager`）
- 客户端注册：浏览器端通过 WebSocket 首包 `register` 上报当前 Flow 页面 URL，后端为其分配 `client_id` 与页面编号。
- 空闲客户端调度：后端维护客户端忙闲状态；为避免连续高频派发，对客户端执行冷却（`CLIENT_COOLDOWN_SECONDS=3`）。
- 任务生命周期与状态字段：
  - `等待中` / `处理中` / `已完成` / `失败` / `超时` / `下载失败`
  - `status_detail` 作为进度/错误详情的载体（由浏览器端发送的 `status` 消息更新）
- 超时处理：`TASK_TIMEOUT_SECONDS=600`，超时会将任务标记为 `超时` 并释放对应客户端。
- 客户端断开处理：断开时释放对应客户端；若客户端断开时其正在处理某任务，会把该任务状态重置为 `等待中`。

2. 图像处理与输出策略
- 图片压缩：当执行任务时，如果参考图片是文件路径，则通过 `PIL` 压缩为 base64（最大约 768KB）以降低 WebSocket 传输压力。
- 输出目录选择：
  - 开发模式：输出目录使用项目内 `output/`，日志在 `logs/`
  - 打包模式：输出目录落到用户文档目录 `~/Documents/veo3free/output`，日志落到 `~/Documents/veo3free/logs`

3. 对前端的 JS API（类 `Api`，由 pywebview 暴露）
- 任务相关：
  - `add_task(prompt, task_type, aspect_ratio, resolution, reference_images, output_dir)`
  - `start_execution()`：启动任务派发循环
  - `stop_execution()`：停止派发循环
  - `run_single_task(task_index)`：把指定等待中的任务移动到当前执行位置并开始执行
  - `retry_task(task_index)`：重试指定失败/超时/下载失败任务（回退索引后必要时自动启动）
  - `retry_all_failed()`：批量重试所有失败任务
  - `clear_tasks()`：清空所有任务并重置内部执行状态
  - `get_status()`：返回客户端数量、运行状态与任务列表（用于前端 UI 渲染）
- 文件/目录相关：
  - `select_images()`：选择多张图片并压缩为 base64
  - `import_excel()`：导入 Excel 批量生成任务（支持任务类型/分辨率/方向校验；导入时仅收集图片路径，压缩延迟到执行时）
  - `export_template()`：导出高级模板 Excel
  - `create_custom_template()`：根据图片文件夹生成简单模板 Excel
  - `open_output_dir()` / `open_logs_dir()`：打开输出/日志目录
  - `open_task_file(task_index)` / `open_task_dir(task_index)`：打开生成结果文件或其所在目录
- 版本与更新：
  - `get_app_version()`：返回当前版本
  - `check_update()`：查询 GitHub 最新 Release（Mac/Windows 资产匹配）
  - `open_update_page(url)`：在浏览器打开更新下载链接
- API 验证（泡椒云卡密，`PJYSDK`）：
  - `get_api_verify_status()`：读取本地设置判断是否已验证
  - `verify_pjy_card(card)`：验证后保存 `api_token` / `api_verified` / `api_key`（用于后续 API 访问校验）

4. Web 端资源选择逻辑
- 开发：如果 `DEV=1` 或 `web/` 不存在，使用 `http://localhost:9173`
- 生产：使用打包后的 `web/index.html`

## API 兼容层（`api_server_fastapi.py`）
1. 统一服务（FastAPI）
- 端口：`API_SERVER_PORT=12346`
- OpenAI 兼容端点：
  - `POST /v1/chat/completions`
    - 支持 `stream=true` 的 SSE 推送（首包发送 role，后续轮询 `task.status_detail` 做进度增量）
    - 非流式：等待任务完成后返回最终 markdown（图片链接或 video 标签）
  - `GET /v1/models`：返回内置模型列表（模型 ID -> 内部任务类型/方向/分辨率/最大图片数）
  - `GET /files/{task_id}`：返回生成文件的静态下载链接
  - `GET /health`：返回服务状态 + 客户端可用性统计
- guide 静态资源会在同一 FastAPI 中提供（由 `register_guide_routes` 注入）。

2. 模型映射与任务创建
- `APIServerConfig.MODEL_MAPPING` 用于把模型 ID 映射到：
  - `task_type`（Create Image / Text to Video / Frames to Video / Ingredients to Video）
  - `aspect_ratio`（16:9 或 9:16）
  - `resolution`（例如 1K、720p）
  - `max_images`（约束输入图片数量；Text to Video 约束为 0）
- `/v1/chat/completions` 内部解析最后一次 `user` 消息：
  - `content` 为 string 时视作 prompt
  - `content` 为 list 时提取 `text` 与 `image_url`（支持 `data:image/...;base64,...`）

3. 返回内容格式
- 若任务已完成：
  - 图片：返回 `![Generated Image](<files url>)`
  - 视频：返回 `<video src='<files url>' controls></video>`

4. API Key 校验
- 使用 HTTP Bearer 方式校验 `api_key`。

## 引导页路由（`server/guide_routes.py`）
- 提供静态资源：
  - `GET /guide`：引导页面 `guide/index.html`
  - `GET /inject.js`：浏览器注入脚本 `guide/inject.js`
  - `GET /api-docs`：API 文档页 `guide/api-docs.html`
- `GET /` 会重定向到 `/guide`

## WebSocket 与任务结果回传（`server/ws_routes.py`）
1. 通信协议概览
- 客户端（`inject.js`）连接 `ws://localhost:12346/ws`
- 首包必须为：
  - `{ "type": "register", "page_url": "<当前 Flow 页面 URL>" }`
- 服务端向客户端回包：
  - `{ "type": "register_success", "client_id": "<id>" }`
- 后续消息类型：
  - `image_chunk`：base64 分片回传
  - `image_data`：base64 整体回传
  - `status`：进度/状态文本回传（用于更新 `task.status_detail`）
  - `result`：失败回传（`error` 字段）

2. 分片合并与落盘
- `image_chunk`：按 `chunk_index` 缓存并在收齐 `total_chunks` 后合并。
- 写文件逻辑：
  - 默认输出到后端设定的 `output_dir_base`
  - 若任务设置了 `output_dir`，则会以该任务的目录作为目标（相对路径会基于 `output_dir_base` 拼接）
  - 图片会额外生成 200x200 缩略图 base64，用于前端预览。

3. 状态更新
- 成功：`status=已完成`，写入 `saved_path` / `output_dir_path` / （对 png/jpg）`preview_base64`
- 失败：`status=失败` 并写入 `status_detail=error`、`end_time`
- `status` 消息只更新 `status_detail`（前端会展示在“处理中/失败”的任务卡上）

## 前端（`web-src/src/App.tsx`）功能
1. 任务创建与队列控制
- 创建任务：
  - 选择任务类型：Create Image / Text to Video / Frames to Video / Ingredients to Video
  - 选择屏幕方向：16:9 或 9:16
  - 选择分辨率：取决于任务类型（图片：1K/2K/4K；视频：720p/1080p）
  - 选择/添加参考图（除 Text to Video 外）
  - 点击“添加到队列”，同时触发 `start_execution()`（延迟 300ms）
- 控制任务队列：
  - “开始/停止”：调用 `start_execution()` / `stop_execution()`
  - 清空任务：调用 `clear_tasks()`
  - 单任务立即执行：调用 `run_single_task(index)`
  - 重试：
    - 单任务：调用 `retry_task(index)`
    - 全部失败：调用 `retry_all_failed()`

2. 任务列表展示
- 任务卡展示：
  - `状态图标`、`提示词`、`aspect_ratio / resolution`
  - `处理中` 显示 `status_detail` 与运行时长
  - `已完成` 展示生成文件路径；图片会展示缩略图

3. 进度轮询
- 前端以固定周期轮询 `get_status()`（每 1.5s），刷新任务与设备在线状态。

4. 模板与批量导入
- 支持：
  - Excel 批量导入（进入批量导入 tab 后选择 xlsx）
  - 下载简单模板与高级模板

5. 更新与 API 验证 UI
- 启动后自动检查更新
- 提供 API 卡密验证弹窗（调用后端 `verify_pjy_card` 并显示验证结果）

## 浏览器自动化（`guide/inject.js`）能力
1. 连接与托管态 UI
- 自动判断是否在 Flow 的 project 页面：
  - 非 project 页面：不连接、并更新状态按钮为“未在项目页”
- WebSocket 连接：
  - 连接成功后显示顶部状态条 `● 已连接 · 勿操作，断开请刷新`
- 托管遮罩（你当前要求的功能）：
  - `showOverlayMask()` 在托管成功后显示全屏遮罩与提示文本
  - 遮罩层禁止用户继续操作页面内容
  - 一旦检测到用户真实点击（`event.isTrusted===true`），触发页面刷新（`location.reload()`），避免处于半自动状态导致后续 DOM 操作失败
  - “刷新”链接允许手动刷新
- 页面可见性监听：页面失活 30s 后自动断开，回到可见时按需重连。

2. 初始化动作
- 当用户在 Flow 首页（`https://labs.google/fx/tools/flow`）时，会在页面加载完成后尝试自动点击 `New project`。

3. DOM 查找与点击工具链（实现自动化鲁棒性）
- 使用 XPath / DOM 遍历工具进行元素定位与点击：
  - `clickByText(containText, elType, anchorText)`：基于文本匹配点击（带重试与兜底候选）
  - `clickByAnyText(needles, ...)`：对多个候选文本依次尝试
  - 任务关键步骤包含对按钮/菜单的点击：
    - `selectModel(mode, primaryText, fallbackTexts)`：先找到模型菜单按钮再选择具体模型项
  - 通用等待：
    - `waitUntil(conditionFn, timeout, interval)`：轮询直至条件满足或超时

4. 提示词输入
- `inputPrompt(prompt_text)` 使用 Slate/React 编辑器节点：
  - 聚焦编辑器
  - 使用 `beforeinput + input` 注入整段文本（避免逐字符输入过慢）

5. 参考图/首尾帧上传与弹窗确认
- 引用图上传：
  - `uploadReferenceImage(base64Data)`：把 base64 转为 File 写入 Flow 的 `<input type="file">`，随后通过 UI 流程把媒体插入到输入区。
  - 上传后会调用 `confirmFlowMediaIfDialog()` 处理弹窗（Add/Insert/Done/Confirm 等）并等待弹窗消失。
- 首尾帧上传：
  - `uploadFrameImages_v2(frameImages)`：
    - 1 张：作为 Start
    - 2 张：第一张填 Start，第二张填 End（End 文案找不到则回退为 Start，保证流程不中断）
  - 上传完成计数：
    - `__uploadExpectedCount` / `__uploadDoneCount` 用于保证媒体已插入完成后再提交生成。

6. 任务执行主流程（`executeTask`）
- 基本流程：
  - 重置计数与 UI
  - 输入 prompt
  - 根据 `taskType` 选择 Image/Video 入口、方向、以及对应模型
  - 上传引用图/首尾帧（除 Text to Video 外）
  - 等待 `__uploadDoneCount >= __uploadExpectedCount`
  - 点击“提交/生成”按钮（优先定位 `arrow_forward` 所在按钮；失败则用按钮文案兜底）
  - 等待生成完成（通过 tile 内的 img/video src 变化判断，超时会失败）
  - 从最终 media `src` 抓取 blob 并转为 base64
  - 将 base64 分片或整体通过 WebSocket 发回服务端（`image_chunk` 或 `image_data`）
- 支持的内部任务分支：
  - Create Image：选择 image 模型后生成图片并回传
  - Text to Video：不上传参考图，直接提交生成并回传视频
  - Frames to Video：上传首尾帧并提交，回传视频
  - Ingredients to Video：循环上传垫图/参考图（最多由模型映射约束）并提交，回传视频

7. 结果回传
- 回传时使用：
  - `sendStatus()` 推送进度文本（前端展示为 `status_detail`）
  - `image_chunk` / `image_data` 传输 base64（由服务端合并与保存）
  - `result` 用于错误回传（由服务端标记任务失败）

## 你需要特别关注的点（维护/排查导向）
- 浏览器端 DOM 自动化强依赖页面结构变化：
  - 元素定位失败通常发生在渲染延迟或文案/结构变化，需要调整等待策略或点击兜底。
- 托管遮罩的“用户点击触发刷新”机制用于避免用户干预导致状态错位。
- WebSocket 的状态链路依赖消息顺序与计数：
  - `__uploadExpectedCount / __uploadDoneCount` 仅用于“媒体插入完成”判断，后续生成仍以页面 tile 中媒体 src 变化为准。

