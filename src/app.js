/**
 * AI智能抠图 - 主逻辑 (修复非正方形图片版)
 * 使用 ONNX Runtime Web 运行 RMBG-1.4 模型进行背景移除
 */

class BackgroundRemover {
    constructor() {
        this.session = null;
        this.originalImage = null;
        this.processedImageData = null;  // 带透明通道的原始处理结果
        this.isProcessing = false;
        this.modelReady = false;
        this.modelLoading = false;

        // 设置参数
        this.settings = {
            feather: 1,
            smooth: 1,
            edgeEnhance: 30,
            threshold: 0,
            contrast: 20,
            bgType: 'transparent',
            bgColor: '#ffffff',
            format: 'png',
            quality: 0.95
        };

        this.init();
    }

    async init() {
        // 加载保存的设置
        this.loadSettings();
        
        // 初始化批量处理
        this.batchFiles = [];
        
        this.bindUIEvents();
        this.initBatchProcessing();
        this.bindMenuEvents();
        this.checkModelAndLoad();
    }

    // ========== 设置管理 ==========
    saveSettings() {
        try {
            localStorage.setItem('backgroundRemoverSettings', JSON.stringify(this.settings));
        } catch (e) {
            console.warn('保存设置失败:', e);
        }
    }

    loadSettings() {
        try {
            const saved = localStorage.getItem('backgroundRemoverSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                this.settings = { ...this.settings, ...parsed };
                
                // 应用设置到 UI
                document.getElementById('featherSlider').value = this.settings.feather;
                document.getElementById('featherValue').textContent = this.settings.feather;
                
                document.getElementById('smoothSlider').value = this.settings.smooth;
                document.getElementById('smoothValue').textContent = this.settings.smooth;
                
                document.getElementById('edgeEnhanceSlider').value = this.settings.edgeEnhance;
                document.getElementById('edgeEnhanceValue').textContent = this.settings.edgeEnhance;
                
                document.getElementById('thresholdSlider').value = this.settings.threshold;
                document.getElementById('thresholdValue').textContent = this.settings.threshold;
                
                document.getElementById('contrastSlider').value = this.settings.contrast;
                document.getElementById('contrastValue').textContent = this.settings.contrast;
                
                document.getElementById('bgType').value = this.settings.bgType;
                document.getElementById('bgColor').value = this.settings.bgColor;
                document.getElementById('formatSelect').value = this.settings.format;
                document.getElementById('qualitySelect').value = this.settings.quality;
                
                // 隐藏/显示背景选项
                document.getElementById('bgColorGroup').style.display = this.settings.bgType === 'color' ? 'flex' : 'none';
                document.getElementById('bgImageGroup').style.display = this.settings.bgType === 'image' ? 'flex' : 'none';
                
                console.log('已加载保存的设置');
            }
        } catch (e) {
            console.warn('加载设置失败:', e);
        }
    }

    updateSetting(key, value) {
        this.settings[key] = value;
        this.saveSettings();
    }

    // ========== 模型加载 ==========
    async checkModelAndLoad() {
        const statusLoading = document.getElementById('statusLoading');
        const statusReady = document.getElementById('statusReady');
        const modelModal = document.getElementById('modelModal');

        // 先尝试直接加载模型
        try {
            statusLoading.querySelector('span:last-child').textContent = '正在初始化 AI 模型...';
            await this.loadModel();
            return; // 加载成功，直接返回
        } catch (e) {
            console.error('模型加载失败:', e);
            // 加载失败，关闭加载提示
            statusLoading.style.display = 'none';
        }
        
        // 如果模型加载失败，不显示下载弹窗，直接显示错误
        // 用户可以刷新重试
        modelModal.classList.add('hidden');
        
        // 显示错误提示
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:white;padding:30px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,0.3);text-align:center;z-index:10000;';
        errorDiv.innerHTML = `
            <h2 style="color:#dc3545;margin-bottom:15px;">⚠️ 模型加载失败</h2>
            <p style="color:#666;margin-bottom:20px;">${e.message || '请检查网络后刷新重试'}</p>
            <button onclick="location.reload()" style="padding:10px 30px;background:#667eea;color:white;border:none;border-radius:5px;cursor:pointer;">刷新重试</button>
        `;
        document.body.appendChild(errorDiv);
    }

    setupDownloadModal() {
        const modal = document.getElementById('modelModal');
        const downloadBtn = document.getElementById('downloadBtn');
        const skipBtn = document.getElementById('skipBtn');
        const progressFill = document.getElementById('progressFill');
        const progressText = document.getElementById('progressText');
        const errorText = document.getElementById('errorText');
        const modalButtons = document.getElementById('modalButtons');

        downloadBtn.addEventListener('click', async () => {
            downloadBtn.disabled = true;
            skipBtn.style.display = 'none';
            progressFill.style.width = '0%';
            progressText.textContent = '准备下载...';
            errorText.textContent = '';

            // 监听下载进度
            window.electronAPI.onDownloadProgress((data) => {
                progressFill.style.width = data.percent + '%';
                progressText.textContent = `下载中: ${data.downloaded} / ${data.total} MB (${data.percent}%)`;
            });

            try {
                const result = await window.electronAPI.downloadModel();
                if (result.success) {
                    progressFill.style.width = '100%';
                    progressText.textContent = '下载完成！正在初始化模型...';
                    setTimeout(async () => {
                        modal.classList.add('hidden');
                        await this.loadModel();
                    }, 500);
                } else {
                    throw new Error(result.error || '下载失败');
                }
            } catch (err) {
                downloadBtn.disabled = false;
                skipBtn.style.display = 'inline-block';
                errorText.textContent = `下载失败: ${err.message}`;
            }
        });

        skipBtn.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    async loadModel() {
        const statusLoading = document.getElementById('statusLoading');
        const statusReady = document.getElementById('statusReady');

        statusLoading.style.display = 'flex';
        statusReady.style.display = 'none';
        statusLoading.querySelector('span:last-child').textContent = '正在初始化 AI 模型...';

        try {
            // 从主进程获取模型的真实文件路径
            const modelFilePath = await window.electronAPI.getModelPath();
            console.log('模型文件路径:', modelFilePath);
            
            // 尝试多种加载方式
            for (const provider of ['wasm', 'cpu']) {
                try {
                    console.log(`尝试使用 ${provider} 提供者加载模型...`);
                    const sessionOptions = provider === 'wasm' 
                        ? { executionProviders: ['wasm'], graphOptimizationLevel: 'all' }
                        : { executionProviders: ['cpu'], graphOptimizationLevel: 'all' };
                    
                    this.session = await ort.InferenceSession.create(modelFilePath, sessionOptions);
                    
                    // 测试模型输出格式
                    const testInput = new ort.Tensor('float32', new Float32Array(1*3*256*256), [1, 3, 256, 256]);
                    const testResults = await this.session.run({ input: testInput });
                    const testOutput = testResults.output || testResults[Object.keys(testResults)[0]];
                    console.log('测试输出 shape:', testOutput.dims);
                    console.log('测试输出前10个值:', Array.from(testOutput.data.slice(0, 10)));
                    
                    this.modelReady = true;
                    statusLoading.style.display = 'none';
                    statusReady.style.display = 'flex';
                    statusReady.innerHTML = '<span>✅</span><span>AI 模型已就绪</span>';
                    console.log(`模型加载成功 (${provider})`);
                    return;
                    
                } catch (err) {
                    console.warn(`${provider} 加载失败:`, err.message);
                }
            }
            
            throw new Error('无法加载 ONNX 模型');

        } catch (localErr) {
            console.error('模型加载失败:', localErr);
            statusLoading.style.display = 'none';
            statusLoading.innerHTML = `
                <span style="color:#dc3545">⚠️ 模型加载失败</span>
                <span style="color:#888;font-size:0.8em">${localErr.message}</span>
            `;
        }
    }

    // ========== UI 事件绑定 ==========
    bindUIEvents() {
        // 上传区域
        const uploadArea = document.getElementById('uploadArea');
        const fileInput = document.getElementById('fileInput');
        const openFileBtn = document.getElementById('openFileBtn');

        uploadArea.addEventListener('click', () => fileInput.click());
        openFileBtn?.addEventListener('click', () => window.electronAPI.openFileDialog());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                // 如果是多选且有批量列表，显示批量面板
                if (e.target.files.length > 1 || this.batchFiles.length > 0) {
                    this.addBatchFiles(e.target.files);
                } else {
                    // 单张图片直接处理
                    this.loadImageFromFile(e.target.files[0]);
                }
            }
        });

        // 拖拽上传
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('dragover');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('dragover');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('dragover');
            // 拖拽多文件时使用批量处理
            if (e.dataTransfer.files.length > 1) {
                this.addBatchFiles(e.dataTransfer.files);
            } else {
                const file = e.dataTransfer.files[0];
                if (file && file.type.startsWith('image/')) this.loadImageFromFile(file);
            }
        });

        // 滑块：实时更新显示值并保存设置
        const sliders = [
            { id: 'featherSlider', valueId: 'featherValue', suffix: 'px', setting: 'feather' },
            { id: 'smoothSlider', valueId: 'smoothValue', suffix: 'px', setting: 'smooth' },
            { id: 'contrastSlider', valueId: 'contrastValue', suffix: '%', setting: 'contrast' },
            { id: 'thresholdSlider', valueId: 'thresholdValue', suffix: '', setting: 'threshold' },
            { id: 'edgeEnhanceSlider', valueId: 'edgeEnhanceValue', suffix: '%', setting: 'edgeEnhance' },
        ];
        sliders.forEach(({ id, valueId, suffix, setting }) => {
            const el = document.getElementById(id);
            const valueEl = document.getElementById(valueId);
            el.addEventListener('input', () => {
                valueEl.textContent = el.value;
                this.updateSetting(setting, parseFloat(el.value));
                this.applyEffects();
            });
        });

        // 背景类型切换
        document.getElementById('bgType').addEventListener('change', (e) => {
            const bgColorGroup = document.getElementById('bgColorGroup');
            const bgImageGroup = document.getElementById('bgImageGroup');
            bgColorGroup.style.display = e.target.value === 'color' ? 'flex' : 'none';
            bgImageGroup.style.display = e.target.value === 'image' ? 'flex' : 'none';
            this.updateSetting('bgType', e.target.value);
            this.applyEffects();
        });

        document.getElementById('bgColor').addEventListener('input', (e) => {
            this.updateSetting('bgColor', e.target.value);
            this.applyEffects();
        });
        
        document.getElementById('bgFile').addEventListener('change', (e) => {
            if (e.target.files[0]) this.loadBgImage(e.target.files[0]);
        });

        // 导出设置
        document.getElementById('formatSelect').addEventListener('change', (e) => {
            this.updateSetting('format', e.target.value);
        });
        
        document.getElementById('qualitySelect').addEventListener('change', (e) => {
            this.updateSetting('quality', parseFloat(e.target.value));
        });

        // 按钮
        document.getElementById('reprocessBtn').addEventListener('click', () => this.reprocess());
        document.getElementById('downloadBtn2').addEventListener('click', () => this.downloadResult());
        document.getElementById('resetBtn').addEventListener('click', () => this.reset());
    }

    bindMenuEvents() {
        window.electronAPI?.onMenuExport(() => this.downloadResult());
        window.electronAPI?.onMenuUndo(() => this.reprocess());
        window.electronAPI?.onMenuReprocess(() => this.reprocess());
        window.electronAPI?.onMenuReset(() => this.reset());
        window.electronAPI?.onOpenFile((filePath) => this.loadImageFromPath(filePath));
        
        // 关于弹窗
        window.electronAPI?.onShowAbout(async () => {
            const img = document.getElementById('zanzhuImg');
            const dataUrl = await window.electronAPI.getZanzhuImage();
            if (dataUrl) {
                img.src = dataUrl;
                img.style.display = 'block';
            }
            document.getElementById('aboutModal').classList.remove('hidden');
            
            // 检查更新
            this.checkForUpdates();
        });
        
        // README 弹窗
        window.electronAPI?.onShowReadme(() => {
            document.getElementById('readmeModal').classList.remove('hidden');
        });
    }

    // 检查更新
    async checkForUpdates() {
        try {
            const updateInfo = await window.electronAPI.checkForUpdates();
            console.log('更新检查结果:', updateInfo);
            
            if (updateInfo.hasUpdate) {
                const message = `发现新版本 v${updateInfo.latestVersion}\n\n${updateInfo.releaseNotes}\n\n是否立即下载？`;
                if (confirm(message)) {
                    if (updateInfo.updateUrl) {
                        window.electronAPI.openExternal(updateInfo.updateUrl);
                    }
                }
            }
        } catch (error) {
            console.error('检查更新失败:', error);
        }
    }

    // ========== 图片加载 ==========
    loadImageFromFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => this.loadImageFromDataUrl(e.target.result);
        reader.onerror = () => alert('文件读取失败，请重试');
        reader.readAsDataURL(file);
    }

    async loadImageFromPath(filePath) {
        try {
            const result = await window.electronAPI.readImageFile(filePath);
            if (result.success) {
                this.loadImageFromDataUrl(result.dataUrl);
            } else {
                alert('无法读取文件: ' + result.error);
            }
        } catch (e) {
            alert('无法读取文件: ' + e.message);
        }
    }

    loadImageFromDataUrl(dataUrl) {
        const img = new Image();
        img.onload = () => {
            console.log(`图片加载成功: ${img.width}x${img.height}`);
            this.originalImage = img;
            document.getElementById('originalSize').textContent = `${img.width} × ${img.height}`;
            this.showWorkspace();
            this.drawOriginal();
            this.processImage();
        };
        img.onerror = () => alert('图片格式不正确或已损坏');
        img.src = dataUrl;
    }

    showWorkspace() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('workspace').style.display = 'block';
    }

    drawOriginal() {
        const canvas = document.getElementById('originalCanvas');
        const ctx = canvas.getContext('2d');
        const maxW = 700, maxH = 500;

        let { width, height } = this.originalImage;
        const scale = Math.min(maxW / width, maxH / height, 1);
        width = Math.round(width * scale);
        height = Math.round(height * scale);

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(this.originalImage, 0, 0, width, height);
    }

    // ========== 核心：AI 抠图处理 ==========
    async processImage() {
        if (this.isProcessing) return;
        if (!this.session) { alert('AI 模型尚未加载'); return; }
        if (!this.originalImage) return;

        this.isProcessing = true;
        document.getElementById('loading').style.display = 'inline';

        try {
            const { inputTensor, originalSize } = this.prepareInput();
            const feeds = { input: inputTensor };
            const results = await this.session.run(feeds);
            this.processOutput(results, originalSize);
            this.applyEffects();
        } catch (err) {
            console.error('处理失败:', err);
            alert('处理失败: ' + err.message);
        } finally {
            this.isProcessing = false;
            document.getElementById('loading').style.display = 'none';
        }
    }

    /**
     * 准备模型输入
     * 关键修复：使用"满裁"（满填充）策略，保持比例填满 1024x1024
     * 不再用灰色填充，彻底避免 mask 坐标偏移问题
     */
    prepareInput() {
        const size = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        const img = this.originalImage;
        const imgRatio = img.width / img.height;

        let drawW, drawH, drawX, drawY;

        if (imgRatio >= 1) {
            // 横版图片：宽高比 >= 1，宽度填满
            drawW = size;
            drawH = Math.round(size / imgRatio);
            drawX = 0;
            drawY = Math.round((size - drawH) / 2);
        } else {
            // 竖版图片：宽高比 < 1，高度填满
            drawH = size;
            drawW = Math.round(size * imgRatio);
            drawX = Math.round((size - drawW) / 2);
            drawY = 0;
        }

        // 白色背景（避免透明背景干扰）
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);
        ctx.drawImage(img, drawX, drawY, drawW, drawH);

        // 获取并转换为模型输入
        const imageData = ctx.getImageData(0, 0, size, size);
        const data = imageData.data;

        const inputData = new Float32Array(3 * size * size);
        for (let i = 0; i < size * size; i++) {
            const j = i * 4;
            inputData[i]                   = (data[j]     / 255.0 - 0.5) / 0.5;
            inputData[size * size + i]     = (data[j + 1] / 255.0 - 0.5) / 0.5;
            inputData[2 * size * size + i] = (data[j + 2] / 255.0 - 0.5) / 0.5;
        }

        const inputTensor = new ort.Tensor('float32', inputData, [1, 3, size, size]);

        return {
            inputTensor,
            originalSize: { width: img.width, height: img.height }
        };
    }

    /**
     * 处理模型输出，生成带透明通道的 ImageData
     * 使用双线性插值采样，避免马赛克边缘
     * 修复：RMBG模型输出是背景概率(0=主体,1=背景)，需要反转
     */
    processOutput(results, originalSize) {
        let output = results.output || results[Object.keys(results)[0]];
        if (!output) { console.error('无法获取模型输出'); return; }

        const maskData = output.data;
        const outputShape = output.dims || output.shape;
        
        // 适配不同输出格式 [1,1,H,W] 或 [1,H,W,1]
        let h, w;
        if (outputShape.length === 4) {
            if (outputShape[1] === 1) { [,,h,w] = outputShape; }
            else if (outputShape[3] === 1) { [,,h,w] = [outputShape[0], outputShape[3], outputShape[1], outputShape[2]]; }
            else { h = outputShape[2]; w = outputShape[3]; }
        } else { h = outputShape[2]; w = outputShape[3]; }

        const imgW = originalSize.width;
        const imgH = originalSize.height;

        // 计算原图在模型输入中的位置（满裁模式）
        const imgRatio = imgW / imgH;
        let drawW, drawH, drawX, drawY;
        
        if (imgRatio >= 1) {
            drawW = 1024;
            drawH = Math.round(1024 / imgRatio);
            drawX = 0;
            drawY = Math.round((1024 - drawH) / 2);
        } else {
            drawH = 1024;
            drawW = Math.round(1024 * imgRatio);
            drawX = Math.round((1024 - drawW) / 2);
            drawY = 0;
        }

        // 创建结果画布
        const resultCanvas = document.getElementById('resultCanvas');
        resultCanvas.width = imgW;
        resultCanvas.height = imgH;
        const resultCtx = resultCanvas.getContext('2d');
        resultCtx.drawImage(this.originalImage, 0, 0);

        const imageData = resultCtx.getImageData(0, 0, imgW, imgH);
        const pixels = imageData.data;

        // 遍历每个像素，从 mask 采样
        for (let py = 0; py < imgH; py++) {
            for (let px = 0; px < imgW; px++) {
                // 原图坐标对应到模型输入坐标
                const modelX = drawX + (px / imgW) * drawW;
                const modelY = drawY + (py / imgH) * drawH;
                
                // 双线性插值采样
                const x0 = Math.floor(modelX);
                const y0 = Math.floor(modelY);
                const x1 = Math.min(x0 + 1, 1023);
                const y1 = Math.min(y0 + 1, 1023);
                
                const fx = modelX - x0;
                const fy = modelY - y0;
                
                // 获取四个采样点（mask 是单通道，按行优先存储）
                const v00 = maskData[y0 * 1024 + x0];
                const v10 = maskData[y0 * 1024 + x1];
                const v01 = maskData[y1 * 1024 + x0];
                const v11 = maskData[y1 * 1024 + x1];
                
                // 双线性插值
                let alpha = (1-fx)*(1-fy)*v00 + fx*(1-fy)*v10 + (1-fx)*fy*v01 + fx*fy*v11;
                
                // RMBG输出: 0=背景(透明), 1=主体(不透明) → 直接转为0-255
                alpha = alpha * 255;
                
                // 不在这里做阈值处理，留给 applyEffects 统一处理
                const i = (py * imgW + px) * 4;
                pixels[i + 3] = Math.round(alpha);
            }
        }

        resultCtx.putImageData(imageData, 0, 0);
        this.processedImageData = resultCtx.getImageData(0, 0, imgW, imgH);
    }

    // ========== 边缘效果 & 预览 ==========
    applyEffects() {
        if (!this.processedImageData) return;

        const feather = parseFloat(document.getElementById('featherSlider').value);
        const smooth = parseFloat(document.getElementById('smoothSlider').value);
        const edgeEnhance = parseInt(document.getElementById('edgeEnhanceSlider').value) / 100;
        const threshold = parseInt(document.getElementById('thresholdSlider').value);
        const contrast = parseInt(document.getElementById('contrastSlider').value) / 100;

        // 深拷贝处理结果
        const imageData = new ImageData(
            new Uint8ClampedArray(this.processedImageData.data),
            this.processedImageData.width,
            this.processedImageData.height
        );

        // 按顺序应用效果（阈值默认0，即不做阈值处理）
        if (threshold > 0) this.applyThreshold(imageData, threshold);
        if (contrast > 0) this.applyContrast(imageData, contrast);
        if (edgeEnhance > 0) this.applyEdgeSharpen(imageData, edgeEnhance);
        if (smooth > 0) this.applyGaussianSmooth(imageData, smooth);
        if (feather > 0) this.applyFeather(imageData, feather);

        // 渲染预览（含背景）
        const resultCanvas = document.getElementById('resultCanvas');
        const ctx = resultCanvas.getContext('2d');
        ctx.clearRect(0, 0, resultCanvas.width, resultCanvas.height);

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = imageData.width;
        tmpCanvas.height = imageData.height;
        tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);

        this.applyBgToCanvas(ctx, tmpCanvas);
    }

    applyThreshold(data, threshold) {
        // 阈值处理：低于阈值的设为完全透明，高于阈值的保持不透明
        const p = data.data;
        for (let i = 3; i < p.length; i += 4) {
            if (p[i] < threshold) {
                p[i] = 0;  // 低于阈值 → 透明
            }
            // 高于阈值的保持原值（主体保持不透明）
        }
    }

    applyContrast(data, factor) {
        const p = data.data;
        const f = (259 * (factor * 100 + 255)) / (255 * (259 - factor * 100));
        for (let i = 0; i < p.length; i += 4) {
            p[i]     = Math.min(255, Math.max(0, f * (p[i]     - 128) + 128));
            p[i + 1] = Math.min(255, Math.max(0, f * (p[i + 1] - 128) + 128));
            p[i + 2] = Math.min(255, Math.max(0, f * (p[i + 2] - 128) + 128));
        }
    }

    applyEdgeSharpen(data, strength) {
        const w = data.width, h = data.height;
        const src = data.data;
        const dst = new Uint8ClampedArray(src);
        const kernel = [-1, -1, -1, -1, 9, -1, -1, -1, -1];

        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                for (let c = 0; c < 4; c++) {
                    let sum = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const ni = ((y + ky) * w + (x + kx)) * 4 + c;
                            sum += src[ni] * kernel[(ky + 1) * 3 + (kx + 1)];
                        }
                    }
                    const orig = src[(y * w + x) * 4 + c];
                    const idx = (y * w + x) * 4 + c;
                    dst[idx] = Math.min(255, Math.max(0, orig + (sum - orig) * strength));
                }
            }
        }
        data.data.set(dst);
    }

    applyGaussianSmooth(data, radius) {
        const w = data.width, h = data.height;
        const sigma = radius * 0.5;
        const k = Math.ceil(radius * 3) * 2 + 1;
        const half = Math.floor(k / 2);

        const src = data.data;
        const tmp = new Float32Array(w * h);

        // 只对 alpha 通道做高斯模糊
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, ws = 0;
                for (let ky = -half; ky <= half; ky++) {
                    for (let kx = -half; kx <= half; kx++) {
                        const nx = x + kx, ny = y + ky;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            const d = Math.sqrt(kx * kx + ky * ky);
                            const weight = Math.exp(-(d * d) / (2 * sigma * sigma));
                            sum += src[(ny * w + nx) * 4 + 3] * weight;
                            ws += weight;
                        }
                    }
                }
                tmp[y * w + x] = sum / ws;
            }
        }

        for (let i = 0; i < w * h; i++) {
            data.data[i * 4 + 3] = Math.round(tmp[i]);
        }
    }

    applyFeather(data, radius) {
        const w = data.width, h = data.height;
        const src = data.data;
        const tmp = new Float32Array(w * h);

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, count = 0;
                const r = Math.floor(radius);
                for (let ky = -r; ky <= r; ky++) {
                    for (let kx = -r; kx <= r; kx++) {
                        const nx = x + kx, ny = y + ky;
                        if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                            sum += src[(ny * w + nx) * 4 + 3];
                            count++;
                        }
                    }
                }
                tmp[y * w + x] = sum / count;
            }
        }

        for (let i = 0; i < w * h; i++) {
            data.data[i * 4 + 3] = Math.round(tmp[i]);
        }
    }

    applyBgToCanvas(ctx, srcCanvas) {
        const bgType = document.getElementById('bgType').value;
        const w = ctx.canvas.width, h = ctx.canvas.height;

        if (bgType === 'color') {
            ctx.fillStyle = document.getElementById('bgColor').value;
            ctx.fillRect(0, 0, w, h);
        } else if (bgType === 'image' && this.bgImage) {
            const img = this.bgImage;
            const cr = w / h, ir = img.width / img.height;
            let dw, dh, dx, dy;
            if (cr > ir) { dw = w; dh = w / ir; }
            else { dh = h; dw = h * ir; }
            dx = (w - dw) / 2; dy = (h - dh) / 2;
            ctx.drawImage(img, dx, dy, dw, dh);
        }
        // transparent: 不画背景，保持透明

        ctx.drawImage(srcCanvas, 0, 0);
    }

    loadBgImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => { this.bgImage = img; this.applyEffects(); };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ========== 操作按钮 ==========
    reprocess() {
        if (this.originalImage) this.processImage();
    }

    reset() {
        document.getElementById('uploadSection').style.display = 'block';
        document.getElementById('workspace').style.display = 'none';
        document.getElementById('batchPanel').style.display = 'none';
        document.getElementById('fileInput').value = '';
        this.originalImage = null;
        this.processedImageData = null;
        this.batchFiles = [];
    }

    async downloadResult() {
        if (!this.processedImageData) return;

        const format = document.getElementById('formatSelect').value;
        const quality = parseFloat(document.getElementById('qualitySelect').value);
        const bgType = document.getElementById('bgType').value;

        const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        const mime = mimeMap[format] || 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : format;

        const imageData = new ImageData(
            new Uint8ClampedArray(this.processedImageData.data),
            this.processedImageData.width,
            this.processedImageData.height
        );

        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = imageData.width;
        exportCanvas.height = imageData.height;
        const ctx = exportCanvas.getContext('2d');

        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = imageData.width;
        tmpCanvas.height = imageData.height;
        tmpCanvas.getContext('2d').putImageData(imageData, 0, 0);

        // 导出时填背景：JPG 强制白底，PNG/WEBP 透明或用户选背景
        if (format === 'jpeg') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
        } else if (bgType !== 'transparent') {
            this.applyBgToCanvas(ctx, tmpCanvas);
        }

        if (format !== 'jpeg' && bgType === 'transparent') {
            ctx.drawImage(tmpCanvas, 0, 0);
        } else if (format !== 'jpeg' && bgType !== 'transparent') {
            ctx.drawImage(tmpCanvas, 0, 0);
        } else {
            ctx.drawImage(tmpCanvas, 0, 0);
        }

        const dataUrl = exportCanvas.toDataURL(mime, quality);
        const defaultName = `抠图结果_${Date.now()}.${ext}`;
        await window.electronAPI.saveFile(dataUrl, defaultName);
    }

    // ========== 批量处理 ==========
    initBatchProcessing() {
        // 绑定批量处理按钮事件
        // 文件选择已在 bindUIEvents 中处理
        
        // 清空列表
        document.getElementById('clearBatchBtn').addEventListener('click', () => {
            this.batchFiles = [];
            this.batchResults = [];
            this.updateBatchList();
        });

        // 开始批量处理
        document.getElementById('startBatchBtn').addEventListener('click', () => {
            this.startBatchProcessing();
        });

        // 导出全部
        document.getElementById('exportAllBtn').addEventListener('click', () => {
            this.exportAllBatchResults();
        });
    }

    addBatchFiles(files) {
        if (!this.batchFiles) this.batchFiles = [];
        
        const maxFiles = 10;
        const currentCount = this.batchFiles.length;
        
        for (let i = 0; i < files.length && currentCount + i < maxFiles; i++) {
            const file = files[i];
            if (file.type.startsWith('image/')) {
                this.batchFiles.push({
                    file: file,
                    name: file.name,
                    status: 'pending',
                    result: null
                });
            }
        }
        
        this.showBatchPanel();
        this.updateBatchList();
    }

    showBatchPanel() {
        document.getElementById('uploadSection').style.display = 'none';
        document.getElementById('batchPanel').style.display = 'block';
    }

    updateBatchList() {
        const list = document.getElementById('batchList');
        const count = document.getElementById('batchCount');
        const doneCount = this.batchFiles.filter(f => f.status === 'done').length;
        
        count.textContent = `(${doneCount}/${this.batchFiles.length})`;
        
        const exportAllBtn = document.getElementById('exportAllBtn');
        exportAllBtn.style.display = doneCount > 0 ? 'inline-block' : 'none';
        
        list.innerHTML = '';
        
        this.batchFiles.forEach((item, index) => {
            const div = document.createElement('div');
            div.className = 'batch-item';
            
            const thumb = document.createElement('img');
            thumb.className = 'batch-item-thumb';
            thumb.src = item.thumb || '';
            
            const info = document.createElement('div');
            info.className = 'batch-item-info';
            
            const name = document.createElement('div');
            name.className = 'batch-item-name';
            name.textContent = item.name;
            
            const status = document.createElement('div');
            status.className = 'batch-item-status';
            if (item.status === 'pending') status.textContent = '等待处理';
            else if (item.status === 'processing') status.textContent = '处理中...';
            else if (item.status === 'done') { status.textContent = '✅ 完成'; status.classList.add('done'); }
            else if (item.status === 'error') { status.textContent = '❌ 失败'; status.classList.add('error'); }
            
            info.appendChild(name);
            info.appendChild(status);
            
            const removeBtn = document.createElement('button');
            removeBtn.className = 'batch-item-remove';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = () => this.removeBatchItem(index);
            
            div.appendChild(thumb);
            div.appendChild(info);
            div.appendChild(removeBtn);
            list.appendChild(div);
        });
    }

    removeBatchItem(index) {
        this.batchFiles.splice(index, 1);
        this.updateBatchList();
        
        if (this.batchFiles.length === 0) {
            document.getElementById('uploadSection').style.display = 'block';
            document.getElementById('batchPanel').style.display = 'none';
        }
    }

    async startBatchProcessing() {
        if (!this.session) {
            alert('AI 模型尚未加载');
            return;
        }
        
        const startBtn = document.getElementById('startBatchBtn');
        startBtn.disabled = true;
        
        for (let i = 0; i < this.batchFiles.length; i++) {
            const item = this.batchFiles[i];
            if (item.status !== 'pending') continue;
            
            item.status = 'processing';
            this.updateBatchList();
            
            try {
                const img = await this.loadImageFromFilePromise(item.file);
                
                const thumbCanvas = document.createElement('canvas');
                thumbCanvas.width = 60;
                thumbCanvas.height = 60;
                const ctx = thumbCanvas.getContext('2d');
                const scale = Math.min(60 / img.width, 60 / img.height);
                const w = img.width * scale;
                const h = img.height * scale;
                ctx.drawImage(img, (60 - w) / 2, (60 - h) / 2, w, h);
                item.thumb = thumbCanvas.toDataURL();
                
                item.image = img;
                item.originalImage = img;
                
                await this.processImageForBatch(item);
                
                item.status = 'done';
            } catch (err) {
                console.error('批量处理失败:', err);
                item.status = 'error';
            }
            
            this.updateBatchList();
        }
        
        startBtn.disabled = false;
    }

    processImageForBatch(item) {
        return new Promise(async (resolve, reject) => {
            try {
                const originalImage = this.originalImage;
                this.originalImage = item.originalImage;
                
                const { inputTensor, originalSize } = this.prepareInput();
                const feeds = { input: inputTensor };
                const results = await this.session.run(feeds);
                
                const imgW = originalSize.width;
                const imgH = originalSize.height;
                
                const resultCanvas = document.createElement('canvas');
                resultCanvas.width = imgW;
                resultCanvas.height = imgH;
                const resultCtx = resultCanvas.getContext('2d');
                resultCtx.drawImage(this.originalImage, 0, 0);
                
                this.processOutput(results, originalSize);
                this.applyEffects();
                
                const tmpCanvas = document.createElement('canvas');
                tmpCanvas.width = this.processedImageData.width;
                tmpCanvas.height = this.processedImageData.height;
                tmpCanvas.getContext('2d').putImageData(this.processedImageData, 0, 0);
                
                item.result = {
                    canvas: tmpCanvas,
                    width: tmpCanvas.width,
                    height: tmpCanvas.height
                };
                
                this.originalImage = originalImage;
                
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    }

    async exportAllBatchResults() {
        for (let i = 0; i < this.batchFiles.length; i++) {
            const item = this.batchFiles[i];
            if (item.status === 'done' && item.result) {
                await this.exportBatchItem(item, i);
            }
        }
    }

    async exportBatchItem(item, index) {
        const format = this.settings.format || 'png';
        const quality = this.settings.quality || 0.95;
        const bgType = this.settings.bgType || 'transparent';
        
        const mimeMap = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
        const mime = mimeMap[format] || 'image/png';
        const ext = format === 'jpeg' ? 'jpg' : format;
        
        const canvas = document.createElement('canvas');
        canvas.width = item.result.width;
        canvas.height = item.result.height;
        const ctx = canvas.getContext('2d');
        
        if (format === 'jpeg' || bgType === 'color') {
            ctx.fillStyle = this.settings.bgColor || '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
        
        ctx.drawImage(item.result.canvas, 0, 0);
        
        const dataUrl = canvas.toDataURL(mime, quality);
        const baseName = item.name.replace(/\.[^/.]+$/, '');
        const defaultName = `${baseName}_抠图.${ext}`;
        
        await window.electronAPI.saveFile(dataUrl, defaultName);
    }

    loadImageFromFilePromise(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = e.target.result;
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new BackgroundRemover();
});
