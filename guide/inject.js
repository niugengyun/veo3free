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
    let overlayMask = null;
    // 用于“按上传图片数量”控制何时允许提交生成（避免未插入完就开始）
    let __uploadExpectedCount = 0;
    let __uploadDoneCount = 0;

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

    // 创建/显示全屏遮罩
    function showOverlayMask() {
        if (!isProjectPage()) return;

        if (overlayMask) {
            overlayMask.style.display = 'flex';
            return;
        }

        overlayMask = document.createElement('div');
        overlayMask.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(150, 150, 150, 0.3);
            z-index: 99998;
            display: flex;
            align-items: center;
            justify-content: center;
            backdrop-filter: blur(1px);
            pointer-events: auto;
        `;

        const tip = document.createElement('div');
        tip.style.cssText = `
            color: white;
            font-size: 20px;
            font-weight: bold;
            text-align: center;
            text-shadow: 0 2px 10px rgba(0,0,0,0.9);
            line-height: 2;
        `;

        tip.innerHTML = `
            页面已托管至 Veo3Free App进行自动化控制<br/>
            <span style="font-size: 15px; opacity: 0.95;">如需恢复手动模式，请</span>
            <a href="javascript:void(0)" id="refresh-link" style="
                color: #4fc3f7;
                text-decoration: underline;
                font-size: 15px;
                cursor: pointer;
                transition: color 0.2s;
            ">刷新</a>页面
        `;

        // overlayMask.appendChild(tip);
        // document.body.appendChild(overlayMask);

        // 刷新链接点击事件
        document.getElementById('refresh-link').addEventListener('click', () => {
            location.reload();
        });

        // 鼠标悬停效果
        document.getElementById('refresh-link').addEventListener('mouseenter', (e) => {
            e.target.style.color = '#81d4fa';
        });
        document.getElementById('refresh-link').addEventListener('mouseleave', (e) => {
            e.target.style.color = '#4fc3f7';
        });
    }

    // 隐藏全屏遮罩
    function hideOverlayMask() {
        if (overlayMask) {
            overlayMask.style.display = 'none';
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
                showOverlayMask();
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

    // 通用等待函数（先等待再检查，避免立即满足条件）
    async function waitUntil(conditionFn, timeout = 60000, interval = 1000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            await sleep(interval);
            const succ = await conditionFn();
            console.log("waitUntil=", succ)
            if (succ) {
                return true
            }
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

        await sleep(1000);
        const ok = await waitUntil(() => $x1('//div[@data-item-index="0"]/div/div[1]//img'));
        if (!ok) throw new Error('上传超时');
    }

    async function selectImgByName(filename) {

        const searchInputEl = $x1('//input[@placeholder]');

        console.warn('searchInputEl', searchInputEl)
        // 触发搜索输入
        if (searchInputEl) {
            function setReactInputValue(element, value) {
                // 获取 React 内部用的原生 value setter（绕过 React 的追踪）
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype,
                    'value'
                ).set;

                nativeInputValueSetter.call(element, value);

                // 派发 input 事件，触发 React 的 onChange 合成事件
                element.dispatchEvent(new Event('input', { bubbles: true }));

                // 部分组件还监听了 change，一并派发保险
                element.dispatchEvent(new Event('change', { bubbles: true }));
            }
            setReactInputValue(searchInputEl, filename);
            await sleep(1000);
            await clickByText(filename, 'div')

        }
    }

    // 上传参考图
    async function uploadReferenceImage(base64Data) {
        await sleep(1000);

        // clickByText('add', '*', 'Add Media');

        const filename = `ref_${Math.random().toString(36).slice(2, 10)}.jpg`;
        await uploadFileToInput(base64Data, filename);



        await clickByText('Create', 'span', 'add_2');

        await selectImgByName(filename)

        await confirmFlowMediaIfDialog()
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
            await selectImgByName(filename)
            await confirmFlowMediaIfDialog()
        }


        if (frameImages.length == 2) {

            await sleep(1000);


            const filename = `ref_${Math.random().toString(36).slice(2, 10)}.jpg`;
            await uploadFileToInput(frameImages[1], filename);


            await clickByText('Start', 'div', 'arrow_forward');
            await selectImgByName(filename)
            await confirmFlowMediaIfDialog()
        }
    }

    // 修复版：两张图时分别填充 Start/End，避免只填入第二张导致“收尾帧视频逻辑不对”
    async function uploadFrameImages_v2(frameImages) {
        if (!frameImages?.length) throw new Error('首帧是必需的');

        if (frameImages.length == 1) {
            await sleep(1000);
            const filename = `ref_${Math.random().toString(36).slice(2, 10)}_start.jpg`;
            await uploadFileToInput(frameImages[0], filename);
            await clickByText('Start', 'div', 'arrow_forward');
            await selectImgByName(filename)
            await confirmFlowMediaIfDialog()
            __uploadDoneCount += 1;
            return;
        }

        if (frameImages.length == 2) {
            await sleep(1000);

            // 首帧 -> Start
            const filenameStart = `ref_${Math.random().toString(36).slice(2, 10)}_start.jpg`;
            await uploadFileToInput(frameImages[0], filenameStart);
            await clickByText('Start', 'div', 'arrow_forward');
            await selectImgByName(filenameStart)
            await confirmFlowMediaIfDialog()
            __uploadDoneCount += 1;

            // 尾帧 -> End（若文案不是 End，则回退到 Start）
            const filenameEnd = `ref_${Math.random().toString(36).slice(2, 10)}_end.jpg`;
            await uploadFileToInput(frameImages[1], filenameEnd);
            try {
                await clickByText('End', 'div', 'arrow_forward');
            } catch (e) {
                console.warn('[uploadFrameImages_v2] End not found, fallback to Start', e && e.message);
                await clickByText('Start', 'div', 'arrow_forward');
            }
            await selectImgByName(filenameEnd)
            await confirmFlowMediaIfDialog()
            __uploadDoneCount += 1;
            return;
        }

        throw new Error('首尾帧数量必须为 1 或 2');
    }

    // 如果素材选择后弹出了对话框（如 Add/Insert/Confirm），点掉它并等待关闭，
    // 目的是确保引用图/首尾帧真正插入到 Flow 的输入区后，再继续生成。
    async function confirmFlowMediaIfDialog() {
        await sleep(500);
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
            console.log('[confirmFlowMediaIfDialog] click', (hit.textContent || '').trim());
            hit.click();
            await sleep(800);
        }

        // 等弹窗消失，避免后续生成太快导致引用图未落位
        await waitUntil(() => !document.querySelector('[role="dialog"]'), 15000, 300);
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
        sendWsMessage({ type: 'status', message: msg });
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
            console.log(`[clickByText] ✅ 完成`);
            await new Promise(resolve => setTimeout(resolve, 300));
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

    async function executeTask(taskId, prompt, taskType, aspectRatio, resolution, referenceImages) {
        console.log('🚀 执行任务:', taskId, taskType, prompt.substring(0, 30) + '...');

        if (isExecuting) return;
        isExecuting = true;
        capturedImageData = null;

        try {
            // 重置“上传完成计数”
            __uploadExpectedCount = 0;
            __uploadDoneCount = 0;

            await clickByText(''); // 重置


            // 输入prompt
            await inputPrompt(prompt)

            await clickByText("crop_", "*", "arrow_forward") // 展开参数

            // 任务类型
            const useType = taskType.indexOf("Image") > -1 ? "Image" : "Video"
            await clickByText(useType, "button", "Landscape")       // 设置任务类型
            await clickByText("x1", "*", "arrow_forward")      // 只出1个

            const useAspect = aspectRatio.indexOf("16:9") > -1 ? "Landscape" : "Portrait"
            await clickByText(useAspect, "*", "arrow_forward") // 设置方向

            if ("Image" == useType) {  // 图片
                await selectModel('image', 'Nano Banana 2', ['Nano Banana', 'Nano Banana Pro', 'Banana 2'])
            } else {                   // 视频
                // 选择视频任务类型：首尾帧还是序列
                if (taskType === 'Frames to Video') { // 
                    await clickByText("Frames", "button", "arrow_forward")
                } else {
                    // Ingredients/References/垫图/素材 等文案可能因页面状态不同而变化
                    await clickByAnyText(
                        ['Ingredients', 'References', 'Ingredient', '素材', '垫图'],
                        'button',
                        'arrow_forward'
                    )
                }

                // 设置模型，分两步：下拉、点击
                await selectModel('video', 'Veo 3.1 - Fast', ['Veo 3.1 - Fast [Lower Priority]', 'Veo 3.1', 'Fast'])
            }

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
                sendStatus('完成 ✅');
            } else {
                sendResult(taskId, '未获取到图片数据');
            }

        } catch (e) {
            console.error('❌ 执行错误:', e);
            sendResult(taskId, e.message);
        } finally {
            isExecuting = false;
        }
    }

    // 初始化
    function init() {
        console.log('🎯 初始化');
        handlePageChange();

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
