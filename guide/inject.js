(function () {
    'use strict';

    console.log('🚀 图片生成 WebSocket 客户端 v3.1');

    if (window.self !== window.top) return;

    let capturedImageData = null;
    let onImageCaptured = null;
    let ws = null;
    let isExecuting = false;
    let clientId = null;
    let shouldConnect = true;
    let hideTimer = null;
    let statusBtn = null;

    const DEBUG_SKIP_SUBMIT_LS = 'veo3free_debug_skip_submit';

    function loadDebugSkipSubmit() {
        try {
            return localStorage.getItem(DEBUG_SKIP_SUBMIT_LS) === '1';
        } catch (e) {
            return false;
        }
    }

    function saveDebugSkipSubmit(v) {
        try {
            localStorage.setItem(DEBUG_SKIP_SUBMIT_LS, v ? '1' : '0');
        } catch (e) {}
    }

    let __debugSkipSubmit = loadDebugSkipSubmit();
    let overlayMask = null;

    /** 仅调整调试按钮定位，避免覆盖 syncLabel 设置的外观 */
    function applyDebugToggleLayout(place) {
        const el = document.getElementById('veo3free-debug-toggle');
        if (!el) return;
        if (place === 'overlay') {
            el.style.setProperty('position', 'relative');
            el.style.setProperty('left', 'auto');
            el.style.setProperty('top', 'auto');
            el.style.setProperty('bottom', 'auto');
            el.style.setProperty('transform', 'none');
            el.style.setProperty('margin-top', '8px');
            el.style.setProperty('z-index', '2147483646');
        } else {
            el.style.setProperty('position', 'fixed');
            el.style.setProperty('left', '50%');
            el.style.setProperty('bottom', '32px');
            el.style.setProperty('top', 'auto');
            el.style.setProperty('transform', 'translateX(-50%)');
            el.style.setProperty('margin-top', '0');
            el.style.setProperty('z-index', '2147483646');
        }
    }

    function ensureDebugToggleButton() {
        const mount = () => {
            const root = document.body || document.documentElement;
            if (!root) return false;
            let el = document.getElementById('veo3free-debug-toggle');
            if (!el) {
                el = document.createElement('button');
                el.id = 'veo3free-debug-toggle';
                el.type = 'button';
                el.title = '打开：只跑到选图/设参，不点生成；关闭：正常提交';
                el.style.cssText = [
                    'position:fixed',
                    'left:50%',
                    'bottom:32px',
                    'top:auto',
                    'transform:translateX(-50%)',
                    'z-index:2147483646',
                    'padding:14px 26px',
                    'min-width:220px',
                    'font-size:15px',
                    'font-weight:700',
                    'border-radius:14px',
                    'cursor:pointer',
                    'pointer-events:auto',
                    'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
                    'letter-spacing:0.03em'
                ].join(';');
                function syncLabel() {
                    if (__debugSkipSubmit) {
                        el.textContent = '调试 ON · 不提交生成';
                        el.style.background = 'linear-gradient(145deg,#f97316,#ea580c)';
                        el.style.color = '#fff';
                        el.style.border = '3px solid #c2410c';
                        el.style.boxShadow = '0 6px 24px rgba(234,88,12,0.55),0 2px 8px rgba(0,0,0,0.2)';
                    } else {
                        el.textContent = '调试 OFF · 正常提交';
                        el.style.background = 'linear-gradient(145deg,#3b82f6,#1d4ed8)';
                        el.style.color = '#fff';
                        el.style.border = '3px solid #1e40af';
                        el.style.boxShadow = '0 6px 24px rgba(37,99,235,0.45),0 2px 8px rgba(0,0,0,0.2)';
                    }
                }
                el.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    __debugSkipSubmit = !__debugSkipSubmit;
                    saveDebugSkipSubmit(__debugSkipSubmit);
                    syncLabel();
                };
                syncLabel();
            } else {
                const inOverlay = overlayMask && overlayMask.style.display !== 'none' && overlayMask.contains(el);
                applyDebugToggleLayout(inOverlay ? 'overlay' : 'standalone');
            }
            if (!root.contains(el) && !(overlayMask && overlayMask.contains(el))) {
                root.appendChild(el);
            }
            return true;
        };
        if (!mount()) {
            setTimeout(() => {
                if (!mount()) setTimeout(mount, 120);
            }, 0);
        }
    }
    // 用于“按上传图片数量”控制何时允许提交生成（避免未插入完就开始）
    let __uploadExpectedCount = 0;
    let __uploadDoneCount = 0;
    /** executeTask 执行期间附带，便于落盘后 status 仍能更新到对应任务 */
    let _currentStatusTaskId = null;

    function getServerOrigin() {
        // 从 inject.js 的 src 推导服务端 origin（避免硬编码端口）
        let src = '';
        try {
            src = (document.currentScript && document.currentScript.src) ? document.currentScript.src : '';
        } catch (e) {
            src = '';
        }
        if (!src) {
            const scripts = Array.from(document.getElementsByTagName('script'));
            const hit = scripts.map(s => s.src).find(u => u && u.indexOf('/inject.js') >= 0);
            src = hit || '';
        }
        try {
            return new URL(src).origin;
        } catch (e) {
            return 'http://localhost:12346';
        }
    }

    function toWsUrl(origin) {
        const wsOrigin = origin.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
        return wsOrigin + '/ws';
    }

    // 检查是否在 project 页面
    function isProjectPage() {
        return /^https:\/\/labs\.google\/fx\/tools\/flow\/project\/.+/.test(location.href);
    }

    // 创建/更新状态按钮
    function createStatusButton() {
        if (statusBtn) return statusBtn;
        ensureDebugToggleButton();
        statusBtn = document.createElement('div');
        statusBtn.style.cssText = `
            position: fixed;
            top: 0;
            left: 50%;
            transform: translateX(-50%);
            z-index: 99999;
            padding: 6px 32px;
            background: #6c757d;
            color: white;
            border-radius: 0 0 8px 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: bold;
            box-shadow: 0 2px 10px rgba(0,0,0,0.3);
            transition: all 0.3s ease;
            text-align: center;
            white-space: nowrap;
        `;
        statusBtn.onclick = () => {
            if (!isProjectPage()) {
                location.href = 'https://labs.google/fx/tools/flow';
                return;
            }
            if (ws?.readyState === WebSocket.OPEN) {
                return;
            }
            shouldConnect = true;
            connect();
        };
        document.body.appendChild(statusBtn);
        return statusBtn;
    }

    function updateButton(text, color, pulse = false) {
        ensureDebugToggleButton();
        if (!statusBtn) createStatusButton();
        statusBtn.textContent = text;
        statusBtn.style.background = color;
        statusBtn.style.animation = pulse ? 'pulse 1.5s infinite' : 'none';

        // 添加脉冲动画样式
        if (pulse && !document.getElementById('ws-pulse-style')) {
            const style = document.createElement('style');
            style.id = 'ws-pulse-style';
            style.textContent = `
                @keyframes pulse {
                    0%, 100% { box-shadow: 0 2px 10px rgba(0,0,0,0.3); }
                    50% { box-shadow: 0 2px 15px rgba(40, 167, 69, 0.6); }
                }
            `;
            document.head.appendChild(style);
        }
    }

    // 创建/显示全屏遮罩（已连接或任务执行中；程序化 click 仍可作用于下方 DOM）
    function showOverlayMask(mode) {
        if (!isProjectPage()) return;

        const busy = mode === 'busy';
        const tipHtml = busy
            ? `任务执行中，请勿在页面上手动点击<br/>
            <span style="font-size: 15px; opacity: 0.95;">若需自行操作 Flow，请</span>
            <a href="javascript:void(0)" id="veo3free-refresh-link" style="
                color: #4fc3f7;
                text-decoration: underline;
                font-size: 15px;
                cursor: pointer;
                transition: color 0.2s;
            ">刷新</a>页面后重试`
            : `已与 Veo3Free 连接，页面处于托管状态<br/>
            <span style="font-size: 15px; opacity: 0.95;">若需自行点击页面，请</span>
            <a href="javascript:void(0)" id="veo3free-refresh-link" style="
                color: #4fc3f7;
                text-decoration: underline;
                font-size: 15px;
                cursor: pointer;
                transition: color 0.2s;
            ">刷新</a>页面`;

        if (overlayMask) {
            overlayMask.style.display = 'flex';
            const tipEl = overlayMask.querySelector('[data-veo3free-overlay-tip]');
            if (tipEl) {
                tipEl.innerHTML = tipHtml;
                bindOverlayRefreshLink(overlayMask);
            }
            overlayMask.dataset.veo3freeMode = busy ? 'busy' : 'idle';
            attachDebugToggleBelowOverlayTip();
            return;
        }

        overlayMask = document.createElement('div');
        overlayMask.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(150, 150, 150, 0.35);
            z-index: 99998;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(1px);
            pointer-events: auto;
        `;
        overlayMask.dataset.veo3freeMode = busy ? 'busy' : 'idle';

        const overlayInner = document.createElement('div');
        overlayInner.setAttribute('data-veo3free-overlay-inner', '1');
        overlayInner.style.cssText =
            'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;max-width:92vw;';

        const tip = document.createElement('div');
        tip.setAttribute('data-veo3free-overlay-tip', '1');
        tip.style.cssText = `
            color: white;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            text-shadow: 0 2px 10px rgba(0,0,0,0.9);
            line-height: 2;
            max-width: 92vw;
        `;

        tip.innerHTML = tipHtml;

        overlayInner.appendChild(tip);
        overlayMask.appendChild(overlayInner);
        document.body.appendChild(overlayMask);

        bindOverlayRefreshLink(overlayMask);
        attachDebugToggleBelowOverlayTip();
    }

    /** 将调试按钮放到遮罩文案（含「刷新页面」）下方 */
    function attachDebugToggleBelowOverlayTip() {
        ensureDebugToggleButton();
        const dbg = document.getElementById('veo3free-debug-toggle');
        if (!dbg || !overlayMask) return;
        let inner = overlayMask.querySelector('[data-veo3free-overlay-inner]');
        const tipEl = overlayMask.querySelector('[data-veo3free-overlay-tip]');
        if (!tipEl) return;
        if (!inner) {
            inner = document.createElement('div');
            inner.setAttribute('data-veo3free-overlay-inner', '1');
            inner.style.cssText =
                'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;max-width:92vw;';
            if (tipEl.parentNode === overlayMask) {
                overlayMask.replaceChild(inner, tipEl);
                inner.appendChild(tipEl);
            } else {
                overlayMask.appendChild(inner);
                inner.appendChild(tipEl);
            }
        }
        inner.appendChild(dbg);
        applyDebugToggleLayout('overlay');
    }

    function bindOverlayRefreshLink(root) {
        const link = root.querySelector('#veo3free-refresh-link');
        if (!link) return;
        link.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            location.reload();
        });
        link.addEventListener('mouseenter', (e) => {
            e.target.style.color = '#81d4fa';
        });
        link.addEventListener('mouseleave', (e) => {
            e.target.style.color = '#4fc3f7';
        });
    }

    // 隐藏全屏遮罩
    function hideOverlayMask() {
        if (overlayMask) {
            overlayMask.style.display = 'none';
        }
        const dbg = document.getElementById('veo3free-debug-toggle');
        if (dbg && overlayMask && overlayMask.contains(dbg)) {
            document.body.appendChild(dbg);
            applyDebugToggleLayout('standalone');
        }
    }

    // 断开连接
    function disconnect() {
        shouldConnect = false;
        if (ws) {
            ws.close();
            ws = null;
        }
        clientId = null;
        hideOverlayMask();
    }

    // 连接 WebSocket
    function connect() {
        if (!isProjectPage()) {
            updateButton('未在项目页', '#6c757d');
            return;
        }
        if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
            return;
        }

        updateButton('连接中...', '#ffc107');
        const wsUrl = toWsUrl(getServerOrigin());
        console.log('连接 ' + wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log('连接成功，发送注册');
            ws.send(JSON.stringify({
                type: 'register',
                page_url: window.location.href
            }));
        };

        ws.onmessage = async (e) => {
            const data = JSON.parse(e.data);

            if (data.type === 'register_success') {
                clientId = data.client_id;
                console.log('注册成功:', clientId);
                updateButton('● 已连接 · 勿操作，断开请刷新', '#28a745', true);
                showOverlayMask('idle');
                return;
            }

            if (data.type === 'switch_mode') {
                // 兼容旧消息格式
                syncSettingsInPage(data.task_type, '16:9', 'x1',
                    data.task_type === 'Create Image' ? 'Nano Banana 2' : 'Veo 3.1 - Fast [Lower Priority]');
                return;
            }

            if (data.type === 'sync_settings') {
                syncSettingsInPage(
                    data.task_type || 'Create Image',
                    data.aspect_ratio || '16:9',
                    data.image_count || 'x1',
                    data.image_model || (data.task_type === 'Create Image' ? 'Nano Banana 2' : 'Veo 3.1 - Fast [Lower Priority]')
                );
                return;
            }

            if (data.type === 'task') {
                console.log('收到任务:', data.task_id);
                await executeTask(
                    data.task_id,
                    data.prompt,
                    data.task_type || 'Create Image',
                    data.aspect_ratio || '16:9',
                    data.resolution || '4K',
                    data.reference_images || []
                );
            }
        };

        ws.onclose = () => {
            console.log('断开');
            clientId = null;
            updateButton('○ 已断开', '#dc3545');
            hideOverlayMask();
            if (shouldConnect && isProjectPage()) {
                setTimeout(connect, 3000);
            }
        };

        ws.onerror = (err) => {
            console.error('错误:', err);
            updateButton('连接错误', '#dc3545');
        };
    }

    // 拦截 Blob URL 获取图片数据
    const origCreateObjectURL = URL.createObjectURL.bind(URL);
    URL.createObjectURL = function (blob) {
        const url = origCreateObjectURL(blob);
        if (blob && (blob.type?.startsWith('image/') || blob.type?.startsWith('video/') || blob.size > 100000)) {
            console.log('📥 拦截Blob:', blob.type, Math.round(blob.size / 1024) + 'KB');
            const reader = new FileReader();
            reader.onloadend = () => {
                capturedImageData = reader.result.split(',')[1];
                if (onImageCaptured) onImageCaptured(capturedImageData);
            };
            reader.readAsDataURL(blob);
        }
        return url;
    };

    function waitForImageData(timeout = 120000) {
        return new Promise(resolve => {
            if (capturedImageData) {
                const data = capturedImageData;
                capturedImageData = null;
                return resolve(data);
            }
            const timer = setTimeout(() => {
                onImageCaptured = null;
                resolve(null);
            }, timeout);
            onImageCaptured = data => {
                clearTimeout(timer);
                onImageCaptured = null;
                capturedImageData = null;
                resolve(data);
            };
        });
    }

    // 拦截pushState和replaceState
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;

    function createCustomEvent() {
        window.dispatchEvent(new CustomEvent('routechange', {
            detail: { url: window.location.href }
        }));
    }

    window.history.pushState = function (...args) {
        originalPushState.apply(this, args);
        createCustomEvent();
    };

    window.history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        createCustomEvent();
    };

    // 监听路由变化
    window.addEventListener('routechange', (event) => {
        console.log('页面变更了:', event.detail.url);
        handlePageChange();
    });

    // 页面可见性监听
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            console.log("页面不可见，30s后将断开连接");
            hideTimer = setTimeout(() => {
                shouldConnect = false;
                ws?.close();
            }, 30000);
        } else {
            console.log("页面恢复可见");
            clearTimeout(hideTimer);
            shouldConnect = true;
            if (isProjectPage() && (!ws || ws.readyState !== WebSocket.OPEN)) {
                connect();
            }
        }
    });

    // 处理页面变化
    function handlePageChange() {
        createStatusButton();

        if (isProjectPage()) {
            // 在项目页面，建立连接
            shouldConnect = true;
            if (!ws || ws.readyState !== WebSocket.OPEN) {
                connect();
            }
        } else {
            // 不在项目页面，断开连接
            disconnect();
            updateButton('未在项目页', '#6c757d');
        }
    }

    // XPath helpers
    const $x1 = (xpath, ctx = document) => document.evaluate(xpath, ctx, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    const $x = (xpath, ctx = document) => {
        const r = [], q = document.evaluate(xpath, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
        for (let i = 0; i < q.snapshotLength; i++) r.push(q.snapshotItem(i));
        return r;
    };

    window.$x = $x
    window.$x1 = $x1

    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // 通用轮询：先立即检查一次，再按 interval 重试（避免无谓多等一整轮）
    async function waitUntil(conditionFn, timeout = 60000, interval = 1000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const succ = await conditionFn();
            if (succ) return true;
            await sleep(interval);
        }
        return false;
    }

    // base64 转 File
    function base64ToFile(base64Data, filename = 'image.jpg') {
        const byteString = atob(base64Data);
        const ab = new ArrayBuffer(byteString.length);
        const ia = new Uint8Array(ab);
        for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
        return new File([new Blob([ab], { type: 'image/jpeg' })], filename, { type: 'image/jpeg' });
    }

    // 上传文件到 input 并等待完成
    async function uploadFileToInput(base64Data, filename = 'image.jpg') {
        const fileInput = $x('//input[@type="file"]')[0];
        if (!fileInput) throw new Error('未找到文件输入框');

        const dt = new DataTransfer();
        dt.items.add(base64ToFile(base64Data, filename));
        fileInput.files = dt.files;
        fileInput.dispatchEvent(new Event('change', { bubbles: true }));

        await sleep(200);
        const ok = await waitUntil(() => $x1('//div[@data-item-index="0"]/div/div[1]//img'), 30000, 120);
        if (!ok) throw new Error('上传超时');
    }

    // 在弹框/列表根节点内找最可能为「文件名卡片」的元素（避免点到整块容器）
    function findBestFilenameTile(root, filename) {
        if (!root || !filename) return null;
        const candidates = [];
        for (const el of root.querySelectorAll('div, button, [role="button"], li')) {
            if (!el.offsetParent) continue;
            const t = (el.textContent || '').trim();
            if (!t.includes(filename)) continue;
            const r = el.getBoundingClientRect();
            const area = r.width * r.height;
            if (area < 150) continue;
            if (area > 1e6) continue;
            candidates.push({ el, area, textLen: t.length });
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => {
            if (a.textLen !== b.textLen) return a.textLen - b.textLen;
            return a.area - b.area;
        });
        return candidates[0].el;
    }

    // rootEl 传入 [role="dialog"] 时只在弹框内搜素与点击，与 uploadReferenceImage 中 Create 流程一致
    function findMediaSearchInput(root) {
        if (!root) return null;
        return root.querySelector('input[placeholder]')
            || root.querySelector('input[type="search"]')
            || root.querySelector('input:not([type="hidden"])');
    }

    async function selectImgByName(filename, rootEl) {
        let searchInputEl = null;
        if (rootEl) {
            searchInputEl = findMediaSearchInput(rootEl);
            if (!searchInputEl) {
                await waitUntil(() => {
                    searchInputEl = findMediaSearchInput(rootEl);
                    return !!searchInputEl;
                }, 6000, 80);
            }
        }
        if (!searchInputEl) {
            searchInputEl = $x1('//input[@placeholder]');
        }

        if (!searchInputEl) {
            console.warn('[selectImgByName] 未找到搜索框');
            return;
        }

        function setReactInputValue(element, value) {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                'value'
            ).set;
            nativeInputValueSetter.call(element, value);
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
        }
        setReactInputValue(searchInputEl, filename);
        await sleep(220);

        const clickRoot = rootEl || document.querySelector('[role="dialog"]') || document;
        let tile = findBestFilenameTile(clickRoot, filename);
        if (!tile && clickRoot) {
            await sleep(120);
            tile = findBestFilenameTile(clickRoot, filename);
        }
        if (tile) {
            dispatchClick(tile);
            await sleep(120);
            return;
        }
        try {
            await clickByText(filename, 'div', 'add_2');
        } catch (e1) {
            try {
                await clickByText(filename, 'div');
            } catch (e2) {
                console.warn('[selectImgByName] 点击失败', filename, e2 && e2.message);
            }
        }
    }

    // 图生视频 / 参考图：带 add_2 图标的按钮（aria-haspopup=dialog），打开媒体库
    function findAddMediaButton() {
        const btns = document.querySelectorAll('button[aria-haspopup="dialog"]');
        for (let i = 0; i < btns.length; i++) {
            const icons = btns[i].querySelectorAll('i.google-symbols, i.material-icons');
            for (let j = 0; j < icons.length; j++) {
                if ((icons[j].textContent || '').trim() === 'add_2') {
                    return btns[i];
                }
            }
        }
        return null;
    }

    async function clickAddMediaDialogButton() {
        let btn = findAddMediaButton();
        if (!btn) {
            await waitUntil(() => !!(btn = findAddMediaButton()), 4000, 80);
        }
        if (btn) {
            dispatchClick(btn);
            await sleep(120);
            return true;
        }
        try {
            await clickByText('Create', 'span', 'add_2');
            return true;
        } catch (e) {
            console.warn('[media] add_2 兜底失败', e && e.message);
            return false;
        }
    }

    // 参考图上传后进媒体库：先点 add_2 打开弹框，再搜索选图
    async function selectUploadedImageInMediaDialog(filename) {
        await clickAddMediaDialogButton();
        await sleep(120);
        const dlg = document.querySelector('[role="dialog"]');
        await selectImgByName(filename, dlg);
        await confirmFlowMediaIfDialog();
    }

    // 弹框已由 Start/End 等打开：不再点 Create（避免 clickByText 长时间重试），直接搜文件名并确认
    async function selectUploadedImageInOpenDialog(filename) {
        const dlg = document.querySelector('[role="dialog"]');
        if (!dlg) {
            throw new Error('选图弹框未打开');
        }
        await selectImgByName(filename, dlg);
        await confirmFlowMediaIfDialog();
    }

    // 上传参考图
    async function uploadReferenceImage(base64Data) {
        await sleep(200);

        const filename = `ref_${Math.random().toString(36).slice(2, 10)}.jpg`;
        await uploadFileToInput(base64Data, filename);
        await selectUploadedImageInMediaDialog(filename);
        __uploadDoneCount += 1;
    }

    // 上传首尾帧
    async function uploadFrameImages(frameImages) {
        if (!frameImages?.length) throw new Error('首帧是必需的');

        if (frameImages.length == 1) {

            await sleep(1000);


            const filename = `ref_${Math.random().toString(36).slice(2, 10)}.jpg`;
            await uploadFileToInput(frameImages[0], filename);


            await clickByText('Start', 'div', 'arrow_forward');
            if (await waitUntil(() => document.querySelector('[role="dialog"]') !== null, 5000, 80)) {
                await selectUploadedImageInOpenDialog(filename);
            } else {
                await selectUploadedImageInMediaDialog(filename);
            }
        }


        if (frameImages.length == 2) {

            await sleep(1000);


            const filename = `ref_${Math.random().toString(36).slice(2, 10)}.jpg`;
            await uploadFileToInput(frameImages[1], filename);


            await clickByText('Start', 'div', 'arrow_forward');
            if (await waitUntil(() => document.querySelector('[role="dialog"]') !== null, 5000, 80)) {
                await selectUploadedImageInOpenDialog(filename);
            } else {
                await selectUploadedImageInMediaDialog(filename);
            }
        }
    }

    // 找到首尾帧插槽按钮（index=0 -> Start，index=1 -> End）
    // 页面结构：div[type="button"].jekiem，按位置区分 Start / End
    function findFrameSlotButton(index) {
        const btns = Array.from(document.querySelectorAll('div[type="button"].jekiem'));
        return btns[index] || null;
    }

    // 点击首尾帧插槽，找不到 End 时回退到 Start
    async function clickFrameSlot(index) {
        await waitUntil(() => document.querySelectorAll('div[type="button"].jekiem').length > 0, 5000, 80);
        const btn = findFrameSlotButton(index);
        if (btn) { btn.click(); return; }
        if (index === 1) {
            console.warn('[frame] End 插槽未找到，回退到 Start');
            findFrameSlotButton(0)?.click();
        } else {
            throw new Error('Start 插槽未找到');
        }
    }

    // 上传首尾帧：先等上传完成（资源进库），再点 Start/End 打开选图，最后搜索选中并确认
    async function uploadFrameImages_v2(frameImages) {
        if (!frameImages?.length) throw new Error('首帧是必需的');

        await waitUntil(() => document.querySelectorAll('div[type="button"].jekiem').length > 0, 8000, 80);

        // 首帧：uploadFileToInput 会等到主区域缩略图出现，表示上传完成
        const filenameStart = `ref_${Math.random().toString(36).slice(2, 10)}_start.jpg`;
        await uploadFileToInput(frameImages[0], filenameStart);
        await clickFrameSlot(0);
        if (!await waitUntil(() => document.querySelector('[role="dialog"]') !== null, 5000, 80)) {
            throw new Error('首帧选图对话框未打开');
        }
        await selectUploadedImageInOpenDialog(filenameStart);
        __uploadDoneCount += 1;

        if (frameImages.length < 2) return;

        await sleep(200);
        await waitUntil(() => document.querySelectorAll('div[type="button"].jekiem').length > 0, 8000, 80);

        const filenameEnd = `ref_${Math.random().toString(36).slice(2, 10)}_end.jpg`;
        await uploadFileToInput(frameImages[1], filenameEnd);
        await clickFrameSlot(1);
        if (!await waitUntil(() => document.querySelector('[role="dialog"]') !== null, 5000, 80)) {
            throw new Error('尾帧选图对话框未打开');
        }
        await selectUploadedImageInOpenDialog(filenameEnd);
        __uploadDoneCount += 1;
    }


    // 如果素材选择后弹出了对话框（如 Add/Insert/Confirm），点掉它并等待关闭，
    // 目的是确保引用图/首尾帧真正插入到 Flow 的输入区后，再继续生成。
    async function confirmFlowMediaIfDialog() {
        await sleep(120);
        const dialog = document.querySelector('[role="dialog"]');
        if (!dialog) return false;

        const buttons = Array.from(dialog.querySelectorAll('button'));
        const prefer = (t) =>
            buttons.find((b) => {
                const x = (b.textContent || '').replace(/\s+/g, ' ').trim();
                return x === t || x.includes(t);
            });

        const hit =
            prefer('Add') ||
            prefer('Insert') ||
            prefer('Done') ||
            prefer('Apply') ||
            prefer('Confirm') ||
            buttons.find((b) => (b.getAttribute('type') || '') === 'submit') ||
            buttons[0];

        if (hit) {
            hit.click();
            await sleep(350);
        }

        // 等弹窗消失，避免后续生成太快导致引用图未落位
        await waitUntil(() => !document.querySelector('[role="dialog"]'), 15000, 120);
        return true;
    }

    function sendWsMessage(data) {
        if (ws?.readyState !== WebSocket.OPEN) return false;
        data._id = Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        ws.send(JSON.stringify(data));
        return true;
    }

    function sendStatus(msg) {
        console.log('📌', msg);
        const payload = { type: 'status', message: msg };
        if (_currentStatusTaskId) {
            payload.task_id = _currentStatusTaskId;
        }
        sendWsMessage(payload);
    }

    function sendResult(taskId, error) {
        sendWsMessage({ type: 'result', task_id: taskId, error });
    }
    async function inputPrompt(prompt_text) {
        const editorDiv = document.querySelector('div[data-slate-editor="true"]');

        if (!editorDiv) {
            console.warn('未找到编辑器');
            return;
        }

        editorDiv.focus();
        await new Promise(r => setTimeout(r, 100));

        const selection = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(editorDiv);
        selection.removeAllRanges();
        selection.addRange(range);

        editorDiv.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'deleteContentBackward'
        }));

        // 直接整段粘贴/插入，避免逐字符输入太慢
        await new Promise(r => setTimeout(r, 80));
        editorDiv.dispatchEvent(new InputEvent('beforeinput', {
            bubbles: true,
            cancelable: true,
            inputType: 'insertText',
            data: String(prompt_text)
        }));
        editorDiv.dispatchEvent(new InputEvent('input', {
            bubbles: true,
            inputType: 'insertText',
            data: String(prompt_text)
        }));

        // 给 Slate/React 一帧时间处理
        await new Promise(r => setTimeout(r, 150));
    }
    window.inputPrompt = inputPrompt



    /**
 * 模拟鼠标点击指定文本的元素
 * @param {string} containText - 目标元素包含的文本
 * @param {string} elType      - 元素标签名，如 'button', 'span', 'div'
 * @param {string} anchorText  - 锚点文本，有多个同名元素时，点击距离锚点最近的那个
 *
 * @example clickByText('button', '删除')              // 直接点击包含"删除"的按钮
 * @example clickByText('button', '删除', '订单A')     // 点击靠近"订单A"的那个"删除"按钮
 * @example clickByText('button', '')                  // containText 为空时，点击坐标 (1, 1)
 *
 * @note 同时派发 PointerEvent + MouseEvent，兼容 Radix UI 等监听 pointer 事件的组件库
 */
    async function clickByText(containText, elType = '*', anchorText = null) {
        console.log(`containText=${containText}, elType=${elType}, anchorText=${anchorText}`)

        const xpathLiteral = (s) => {
            const str = String(s ?? '');
            if (!str.includes("'")) return "'" + str + "'";
            return 'concat(' + str.split("'").map((part, i) => (i ? ", \"'\", " : "") + "'" + part + "'").join('') + ')';
        };

        const $x = (xpath, ctx = document) => {
            const r = [], q = document.evaluate(xpath, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            for (let i = 0; i < q.snapshotLength; i++) r.push(q.snapshotItem(i));
            return r;
        };

        const dispatch = (target, cx, cy) => {
            const pos = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            target.dispatchEvent(new PointerEvent('pointerdown', { ...pos, pointerId: 1 }));
            target.dispatchEvent(new PointerEvent('pointerup', { ...pos, pointerId: 1 }));
            ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
                target.dispatchEvent(new MouseEvent(type, pos));
            });
        };

        // containText 为空时，点击坐标 (1, 1) 处的元素
        if (!containText) {
            const target = document.elementFromPoint(1, 1) ?? document.body;
            // console.log(`[clickByText] containText 为空，点击坐标 (1, 1)`, target);
            dispatch(target, 1, 1);
            // console.log(`[clickByText] ✅ 完成`);
            return;
        }

        const lit = xpathLiteral(containText);
        const anchorLit = anchorText ? xpathLiteral(anchorText) : null;

        // UI 渲染存在延迟：找不到候选/锚点时先重试，避免出现 target/anchor undefined
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
            const xpaths = [];
            // 主搜索：严格使用 elType
            xpaths.push(`//${elType}[contains(., ${lit})]`);
            // 兜底：当 elType=button 但真实 DOM 可能是 role=button
            if (elType === 'button') {
                xpaths.push(`//*[@role="button" and contains(., ${lit})]`);
            }
            // 最后兜底：任何可包含文本的元素（仍会用 anchor 做最近排序）
            xpaths.push(`//*[contains(., ${lit})]`);

            let candidates = [];
            for (let i = 0; i < xpaths.length; i++) {
                candidates = Array.from($x(xpaths[i]));
                if (candidates && candidates.length) break;
            }
            let target = candidates[0] || null;

            if (anchorText) {
                const anchor = $x(`//*[contains(., ${anchorLit})]`)[0];
                if (!anchor) {
                    await sleep(200);
                    continue;
                }
                const { x: ax, y: ay } = anchor.getBoundingClientRect();
                target = candidates.sort((a, b) => {
                    const ra = a.getBoundingClientRect();
                    const rb = b.getBoundingClientRect();
                    return Math.hypot(ra.x - ax, ra.y - ay) - Math.hypot(rb.x - ax, rb.y - ay);
                })[0];
            }

            if (!target) {
                await sleep(200);
                continue;
            }

            const { x, y, width, height } = target.getBoundingClientRect();
            if (!width || !height) {
                await sleep(200);
                continue;
            }

            const cx = x + width / 2, cy = y + height / 2;
            console.log(`[clickByText] 点击坐标: (${cx.toFixed(0)}, ${cy.toFixed(0)})`, target);

            dispatch(target, cx, cy);
            await new Promise(resolve => setTimeout(resolve, 120));
            return;
        }

        throw new Error(`clickByText 找不到元素：containText=${containText}, elType=${elType}, anchorText=${anchorText}`);
    }
    window.clickByText = clickByText

    // 尝试多个文案，直到成功点击（用于 UI 文案在不同状态/语言下不一致）
    async function clickByAnyText(needles, elType = '*', anchorText = null) {
        let lastErr = null;
        for (let i = 0; i < needles.length; i++) {
            const t = needles[i];
            try {
                await clickByText(t, elType, anchorText);
                return;
            } catch (e) {
                lastErr = e;
                console.warn('[clickByAnyText] miss', t, e && e.message);
            }
        }
        // 兜底：不使用 anchorText，避免图标文本不匹配
        if (anchorText) {
            for (let i = 0; i < needles.length; i++) {
                const t = needles[i];
                try {
                    await clickByText(t, elType, null);
                    return;
                } catch (e) {
                    lastErr = e;
                    console.warn('[clickByAnyText] fallback miss', t, e && e.message);
                }
            }
        }
        throw lastErr || new Error('clickByAnyText 全部失败');
    }

    // ----- DOM 工具（给 selectModel / findModelMenuButton 使用）-----
    function normUiText(el) {
        return (el && String(el.textContent || '').replace(/\s+/g, ' ').trim()) || '';
    }

    function deepQuerySelectorAll(selector, root) {
        const out = [];
        const base = root || document;

        function walk(r) {
            if (!r || !r.querySelectorAll) return;
            let list;
            try {
                list = r.querySelectorAll(selector);
            } catch (e) {
                list = [];
            }
            for (let i = 0; i < list.length; i++) out.push(list[i]);

            let nodes = [];
            try {
                nodes = r.querySelectorAll('*');
            } catch (e2) {
                nodes = [];
            }
            for (let i = 0; i < nodes.length; i++) {
                const el = nodes[i];
                if (el && el.shadowRoot) walk(el.shadowRoot);
            }
        }

        walk(base);
        return out;
    }

    function clickFirstVisible(el) {
        if (!el) return false;
        try {
            el.scrollIntoView({ block: 'center', inline: 'center' });
        } catch (e) {
            // ignore
        }
        try {
            el.click();
            return true;
        } catch (e) {
            return false;
        }
    }

    function findModelMenuButton(mode) {
        const btns = deepQuerySelectorAll('button');
        let best = null;
        let bestScore = -1;
        const want = mode === 'video' ? 'veo' : 'nano';
        const extraWant = mode === 'video' ? ['fast', 'quality'] : ['banana', 'pro'];

        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (!b || !b.getAttribute) continue;
            const aria = String(b.getAttribute('aria-haspopup') || '').toLowerCase();
            const text = normUiText(b).toLowerCase();
            if (!aria.includes('menu')) continue;
            if (!text.includes(want)) continue;

            let score = 0;
            score += 80;
            for (let j = 0; j < extraWant.length; j++) {
                if (text.includes(extraWant[j])) score += 10;
            }
            if (text.includes('3.1')) score += 10;
            if (text.includes('nano')) score += 5;

            if (score > bestScore) {
                bestScore = score;
                best = b;
            }
        }
        return best;
    }

    async function selectModel(mode, primaryText, fallbackTexts) {
        const menuBtn = findModelMenuButton(mode);
        if (menuBtn) {
            console.log('[selectModel] click menu button', mode, normUiText(menuBtn).slice(0, 60));
            clickFirstVisible(menuBtn);
            await sleep(500);
        }

        const needles = [primaryText].concat(fallbackTexts || []);
        // 选项在菜单里，避免使用 arrow_forward 锚点（容易匹配不到）
        await clickByAnyText(needles, '*', null);
        await sleep(500);
    }


    // async function handleImageGen(taskType, aspectRatio, resolution, referenceImages) {
    //     await clickByText(''); // 重置

    //     await clickByText("crop_", "*", "arrow_forward") // 展开参数

    //     // 任务类型
    //     const useType = taskType.indexOf("Image") > -1 ? "Image" : "Video"
    //     await clickByText(useType, "*", "arrow_forward")   // 设置任务类型
    //     await clickByText("x1", "*", "arrow_forward")      // 只出1个

    //     const useAspect = aspectRatio.indexOf("16:9") > -1 ? "Landscape" : "Portrait"
    //     await clickByText(useAspect, "*", "arrow_forward") // 设置方向

    //     if ("Image" == useType) {
    //         await clickByText("arrow_drop_down", "*", "arrow_forward")
    //         await clickByText("Nano Banana 2", "*", "arrow_forward")
    //     } else {
    //         await clickByText("arrow_drop_down", "*", "arrow_forward")
    //         await clickByText("Veo 3.1 - Quality", "*", "arrow_forward")
    //     }
    // }

    // 派发完整事件链，兼容 Radix UI / React 合成事件
    function dispatchClick(el) {
        const rect = el.getBoundingClientRect();
        const cx = rect.x + rect.width / 2;
        const cy = rect.y + rect.height / 2;
        const pos = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
        el.dispatchEvent(new PointerEvent('pointerdown', { ...pos, pointerId: 1 }));
        el.dispatchEvent(new PointerEvent('pointerup', { ...pos, pointerId: 1 }));
        ['mouseover', 'mouseenter', 'mousemove', 'mousedown', 'mouseup', 'click'].forEach(type => {
            el.dispatchEvent(new MouseEvent(type, pos));
        });
    }

    // 找到含 crop_16_9 图标的设置面板切换按钮（aria-haspopup="menu"）
    function findSettingsToggleButton() {
        const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
        for (let i = 0; i < btns.length; i++) {
            const icons = btns[i].querySelectorAll('i.google-symbols');
            for (let j = 0; j < icons.length; j++) {
                const txt = (icons[j].textContent || '').trim();
                if (txt.startsWith('crop_')) return btns[i];
            }
        }
        return null;
    }

    // 确保设置面板已打开，返回是否成功
    async function ensureSettingsPanelOpen() {
        if (document.querySelectorAll('button.flow_tab_slider_trigger').length >= 2) return true;
        const btn = findSettingsToggleButton();
        if (!btn) { console.warn('[sync] 找不到设置按钮'); return false; }
        dispatchClick(btn);
        for (let i = 0; i < 15; i++) {
            await sleep(200);
            if (document.querySelectorAll('button.flow_tab_slider_trigger').length >= 2) return true;
        }
        console.warn('[sync] 设置面板打开超时');
        return false;
    }

    // 找到模型下拉按钮（有 arrow_drop_down、无 crop_ 图标）
    function findModelDropdownButton() {
        const btns = document.querySelectorAll('button[aria-haspopup="menu"]');
        for (const btn of btns) {
            const icons = btn.querySelectorAll('i.google-symbols');
            let hasArrow = false, hasCrop = false;
            for (const icon of icons) {
                const t = (icon.textContent || '').trim();
                if (t === 'arrow_drop_down') hasArrow = true;
                if (t.startsWith('crop_')) hasCrop = true;
            }
            if (hasArrow && !hasCrop) return btn;
        }
        return null;
    }

    // 在面板内找 flow_tab_slider_trigger 按钮并点击（exact=true 精确匹配，否则包含匹配）
    async function clickPanelTab(text, exact = false) {
        const tabs = Array.from(document.querySelectorAll('button.flow_tab_slider_trigger'));
        const btn = tabs.find(b => exact
            ? (b.textContent || '').trim() === text
            : (b.textContent || '').includes(text));
        if (btn) { dispatchClick(btn); await sleep(300); return true; }
        console.warn('[sync] 未找到面板按钮:', text);
        return false;
    }

    // 打开模型下拉并点击目标项，点击后按 Escape 关闭菜单
    async function syncModel(modelName) {
        const btn = findModelDropdownButton();
        if (!btn) { console.warn('[sync] 未找到模型按钮'); return; }
        dispatchClick(btn);
        for (let i = 0; i < 20; i++) {
            for (const menu of document.querySelectorAll('[data-radix-menu-content]')) {
                const span = Array.from(menu.querySelectorAll('span'))
                    .find(el => (el.textContent || '').trim().includes(modelName));
                if (span) {
                    (span.closest('button') || span).click();
                    await sleep(100);
                    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
                    return;
                }
            }
            await sleep(150);
        }
        console.warn('[sync] 未找到模型选项:', modelName);
    }

    // 代次计数器，每次新同步请求递增，旧协程通过 stale() 检测到后自动放弃
    let _syncGeneration = 0;

    // 同步所有设置到网页（任务类型/比例/数量/模型），仅空闲时执行
    async function syncSettingsInPage(taskType, aspectRatio, count, model) {
        if (isExecuting) return;
        const myGen = ++_syncGeneration;
        const stale = () => myGen !== _syncGeneration;
        try {
            if (!await ensureSettingsPanelOpen()) return;
            if (stale()) return;

            // Image / Video tab
            const tabs = Array.from(document.querySelectorAll('button.flow_tab_slider_trigger'));
            const modeTab = tabs[taskType === 'Create Image' ? 0 : 1];
            if (modeTab) { dispatchClick(modeTab); await sleep(400); }
            if (stale()) return;

            // 视频专属：子类型（Frames / Ingredients）
            if (taskType !== 'Create Image') {
                await clickPanelTab(taskType === 'Frames to Video' ? 'Frames' : 'Ingredients');
                if (stale()) return;
            }

            // 比例（图片：16:9/4:3/1:1/3:4/9:16；视频：9:16/16:9）
            await clickPanelTab(aspectRatio);
            if (stale()) return;

            // 数量（x1/x2/x3/x4，精确匹配）
            await clickPanelTab(count, true);
            if (stale()) return;

            // 模型
            await syncModel(model);

        } catch (e) {
            console.warn('[sync] 同步失败:', e.message);
        }
    }

    async function executeTask(taskId, prompt, taskType, aspectRatio, resolution, referenceImages) {
        console.log('🚀 执行任务:', taskId, taskType, prompt.substring(0, 30) + '...');

        if (isExecuting) return;
        isExecuting = true;
        showOverlayMask('busy');
        capturedImageData = null;
        _currentStatusTaskId = taskId;

        try {
            // 重置“上传完成计数”
            __uploadExpectedCount = 0;
            __uploadDoneCount = 0;

            await clickByText(''); // 重置


            // 输入prompt
            await inputPrompt(prompt)

            // 解析通用参数（resolution 编码格式："{count}|{model}"）
            const defaultModel = taskType === 'Create Image' ? 'Nano Banana 2' : 'Veo 3.1 - Fast [Lower Priority]';
            let genCount = 'x1';
            let genModel = defaultModel;
            if (resolution && resolution.includes('|')) {
                const parts = resolution.split('|');
                genCount = parts[0] || 'x1';
                genModel = parts[1] || defaultModel;
            }

            // 展开设置面板并同步任务参数（复用 syncSettingsInPage 的 helper）
            const useType = taskType.indexOf('Image') > -1 ? 'Image' : 'Video';
            await ensureSettingsPanelOpen();

            // Image / Video tab
            const modeTabs = Array.from(document.querySelectorAll('button.flow_tab_slider_trigger'));
            const modeTab = modeTabs[taskType === 'Create Image' ? 0 : 1];
            if (modeTab) { dispatchClick(modeTab); await sleep(400); }

            if (taskType !== 'Create Image') {
                // 视频子类型：Frames（首尾帧）/ Ingredients（文生/图生视频）
                await clickPanelTab(taskType === 'Frames to Video' ? 'Frames' : 'Ingredients');
            }

            // 比例
            await clickPanelTab(aspectRatio);

            // 数量（精确匹配 x1/x2/x3/x4）
            await clickPanelTab(genCount, true);

            // 模型
            await syncModel(genModel);

            // 再上传图片
            if (taskType === 'Frames to Video') { // 只有首尾帧点击的是Start + End 按钮
                __uploadExpectedCount = referenceImages?.length || 0;
                sendStatus('上传首尾帧...');
                await uploadFrameImages_v2(referenceImages);
            } else if (taskType !== 'Text to Video' && referenceImages?.length) { // 其它情况都是点 “+”
                __uploadExpectedCount = referenceImages?.length || 0;
                const name = taskType === 'Ingredients to Video' ? '垫图' : '参考图';
                for (let i = 0; i < referenceImages.length; i++) {
                    sendStatus(`上传${name} ${i + 1}/${referenceImages.length}...`);
                    await uploadReferenceImage(referenceImages[i]);
                    await sleep(500);
                }
            }


            // 点击 开始生成 按钮（关键：否则会直接下载上传预览图，而不是视频成品）
            // 等待：确保引用图片全部“插入完成”（基于上传完成计数）
            if (__uploadExpectedCount > 0) {
                await waitUntil(() => __uploadDoneCount >= __uploadExpectedCount, 60000, 200);
            }

            if (__debugSkipSubmit) {
                sendStatus('调试模式：已就绪，未提交生成');
                return;
            }

            sendStatus('提交生成...');
            await sleep(600);

            // 先记录当前 tile 里已有的媒体 src，生成后需要变化才算成功
            const outputContainerBefore = $x1('//div[@data-item-index="0"]//div[@data-tile-id]');
            const expectVideo = useType === 'Video';
            const existingMediaElBefore = expectVideo ? $x1('.//video', outputContainerBefore) : $x1('.//img', outputContainerBefore);
            const existingSrcBefore = existingMediaElBefore && existingMediaElBefore.src ? String(existingMediaElBefore.src) : '';

            // 尝试点击“提交/生成”按钮：优先点 arrow_forward 图标所在按钮
            let genBtn = null;
            try {
                genBtn = $x1('//button[.//i[contains(., "arrow_forward")]]') ||
                    $x1('//*[self::button or @role="button"][.//i[contains(., "arrow_forward")]]');
            } catch (e) {
                genBtn = null;
            }
            if (genBtn) {
                genBtn.click();
            } else {
                // 兜底：点按钮文本
                try {
                    await clickByAnyText(['Generate', '生成', 'Create', '提交'], 'button', null);
                } catch (e2) {
                    // 最后兜底：还是尝试点击箭头图标
                    await clickByText('arrow_forward', '*', null);
                }
            }

            // sendStatus('等待生成...');

            // 等待生成完成
            const genOk = await waitUntil(() => {
                const container = $x1('//div[@data-item-index="0"]//div[@data-tile-id]');
                if (!container) return false;
                const mediaEl = expectVideo ? $x1('.//video', container) : $x1('.//img', container);
                if (mediaEl && mediaEl.src && String(mediaEl.src).length > 12 && String(mediaEl.src) !== existingSrcBefore) {
                    return true;
                }
                const text = container.innerText;
                if (text?.trim().endsWith('%')) sendStatus('进度 ' + text);
                else if (text && !text.includes('\n')) throw new Error('生成失败: ' + text);
                return false;
            }, expectVideo ? 300000 : 120000);
            if (!genOk) throw new Error('生成超时');

            // 下载
            sendStatus('下载中...');

            const resMap = {
                "1080p": "Upscaled (1080p)", "720p": "Original size (720p)",
                "4K": "Download 4K", "2K": "Download 2K", "1K": "Download 1K"
            };

            let base64Data = null;

            const mediaEl = expectVideo
                ? $x1('//div[@data-item-index="0"]//div[@data-tile-id]//video')
                : $x1('//div[@data-item-index="0"]//div[@data-tile-id]//img');
            if (!mediaEl || !mediaEl.src) throw new Error('未找到生成媒体资源');
            const response = await fetch(mediaEl.src);
            const blob = await response.blob();

            base64Data = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result.split(',')[1]);
                };
                reader.readAsDataURL(blob);
            });



            // if (resolution.toUpperCase() === '1K') {
            //     const img1k = $x1('//div[@data-item-index="0"]//div[@data-tile-id]//img');
            //     const response = await fetch(img1k.src);
            //     const blob = await response.blob();

            //     base64Data = await new Promise((resolve) => {
            //         const reader = new FileReader();
            //         reader.onloadend = () => {
            //             resolve(reader.result.split(',')[1]);
            //         };
            //         reader.readAsDataURL(blob);
            //     });
            // } else {
            //     const resolutionText = resMap[resolution];
            //     if (!resolutionText) throw new Error('未知分辨率: ' + resolution);
            //     const dlBtn = $x1(`//div[contains(text(), '${resolutionText}')]`);
            //     if (!dlBtn) throw new Error('未找到 ' + resolutionText + ' 下载按钮');
            //     dlBtn.click();

            //     // 等待图片数据
            //     sendStatus('获取数据...');
            //     base64Data = await waitForImageData(4 * 60 * 1000);
            // }


            if (base64Data) {
                sendStatus('发送数据...');
                const chunkSize = 1024 * 1024;
                const totalChunks = Math.ceil(base64Data.length / chunkSize);

                if (totalChunks > 1) {
                    for (let i = 0; i < totalChunks; i++) {
                        sendWsMessage({
                            type: 'image_chunk',
                            task_id: taskId,
                            chunk_index: i,
                            total_chunks: totalChunks,
                            data: base64Data.slice(i * chunkSize, (i + 1) * chunkSize)
                        });
                        await sleep(100);
                    }
                } else {
                    sendWsMessage({ type: 'image_data', task_id: taskId, data: base64Data });
                }
                sendStatus('已完成');
            } else {
                sendResult(taskId, '未获取到图片数据');
            }

        } catch (e) {
            console.error('❌ 执行错误:', e);
            sendResult(taskId, e.message);
        } finally {
            _currentStatusTaskId = null;
            isExecuting = false;
            if (ws && ws.readyState === WebSocket.OPEN) {
                showOverlayMask('idle');
            }
        }
    }

    // 初始化
    function init() {
        console.log('🎯 初始化');
        handlePageChange();
        setTimeout(() => ensureDebugToggleButton(), 300);

        // 如果在首页，自动点击 New project
        if (location.href === 'https://labs.google/fx/tools/flow') {
            setTimeout(() => {
                const newProjectBtn = $x1('//button[text()="New project"]');
                if (newProjectBtn) {
                    console.log('自动点击 New project 按钮');
                    newProjectBtn.click();
                }
            }, 1000);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
