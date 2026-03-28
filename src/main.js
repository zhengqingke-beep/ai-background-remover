/**
 * AI 智能抠图 - Electron 主进程
 */

const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const log = require('electron-log');

// 日志配置
log.transports.file.level = 'info';
log.transports.file.maxSize = 5 * 1024 * 1024; // 5MB
log.info('='.repeat(50));
log.info('AI智能抠图启动中...');
log.info('='.repeat(50));

// 全局引用
let mainWindow = null;
let modelPath = '';
let assetsPath = '';

// 获取资源路径（优先 asar 内部，其次 extraResources 目录）
function getResourcePath(relativePath) {
  if (app.isPackaged) {
    // asar 内部路径（打包进 app.asar 的文件）
    const asarPath = path.join(__dirname, '..', relativePath);
    if (fs.existsSync(asarPath)) {
      log.info('资源在 asar 内:', asarPath);
      return asarPath;
    }
    // extraResources 解包路径
    const extraPath = path.join(process.resourcesPath, relativePath);
    if (fs.existsSync(extraPath)) {
      log.info('资源在 extraResources:', extraPath);
      return extraPath;
    }
    return extraPath;
  }
  return path.join(__dirname, '..', relativePath);
}

// 初始化路径
function initPaths() {
  // 模型可能在三个位置：
  // 1. app 目录 (resources/app/assets/)
  // 2. resources/assets 目录
  // 3. 开发环境项目目录
  const candidates = [
    path.join(__dirname, '..', 'assets', 'bria_rmbg_1.4.onnx'),  // resources/app/assets
    path.join(process.resourcesPath, 'assets', 'bria_rmbg_1.4.onnx'),  // resources/assets
    path.join(process.resourcesPath, '..', 'app', 'assets', 'bria_rmbg_1.4.onnx'),  // ../app/assets
    path.join(__dirname, '..', '..', 'assets', 'bria_rmbg_1.4.onnx'),  // 开发环境
  ];
  
  log.info('__dirname:', __dirname);
  log.info('process.resourcesPath:', process.resourcesPath);
  
  for (let i = 0; i < candidates.length; i++) {
    const p = candidates[i];
    const exists = fs.existsSync(p);
    log.info(`候选路径 ${i+1}: ${p} -> ${exists ? '存在' : '不存在'}`);
    if (exists) {
      modelPath = p;
      assetsPath = path.dirname(p);
      break;
    }
  }
  
  if (!modelPath) {
    // 默认下载路径：用户文档目录
    assetsPath = path.join(app.getPath('userData'), 'assets');
    modelPath = path.join(assetsPath, 'bria_rmbg_1.4.onnx');
    log.warn('模型不存在，将下载到:', modelPath);
  }
  
  log.info('资源路径:', assetsPath);
  log.info('模型路径:', modelPath);
}

// 检查模型文件
function checkModel() {
  if (fs.existsSync(modelPath)) {
    const stats = fs.statSync(modelPath);
    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log.info(`模型文件已存在: ${sizeMB} MB`);
    return true;
  }
  log.warn('模型文件不存在');
  return false;
}

// 下载模型文件
async function downloadModel(progressCallback) {
  const url = 'https://huggingface.co/briaai/RMBG-1.4/resolve/main/bria_rmbg_1.4.onnx';
  const tmpPath = modelPath + '.tmp';
  
  log.info('开始下载模型...');
  log.info('下载地址:', url);

  return new Promise((resolve, reject) => {
    // 确保目录存在
    const dir = path.dirname(modelPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const protocol = url.startsWith('https') ? https : http;
    
    const request = protocol.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    }, (response) => {
      // 处理重定向（支持 301/302/307/308）
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        let redirectUrl = response.headers.location;
        if (redirectUrl && !redirectUrl.startsWith('http')) {
          // 相对路径重定向
          const parsedUrl = new URL(url);
          redirectUrl = `${parsedUrl.protocol}//${parsedUrl.host}${redirectUrl}`;
        }
        log.info('重定向到:', redirectUrl);
        const redirProtocol = redirectUrl.startsWith('https') ? https : http;
        redirProtocol.get(redirectUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        }, handleResponse).on('error', reject);
        return;
      }

      handleResponse(response);
    });

    function handleResponse(response) {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }

      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloaded = 0;

      const file = fs.createWriteStream(tmpPath);
      
      response.on('data', (chunk) => {
        downloaded += chunk.length;
        if (totalSize > 0) {
          const percent = ((downloaded / totalSize) * 100).toFixed(1);
          progressCallback(percent, downloaded, totalSize);
        }
      });

      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        // 下载完成后重命名
        if (fs.existsSync(modelPath)) {
          fs.unlinkSync(modelPath);
        }
        fs.renameSync(tmpPath, modelPath);
        log.info('模型下载完成!');
        resolve();
      });

      file.on('error', (err) => {
        file.close();
        fs.unlink(tmpPath, () => {});
        reject(err);
      });
    }

    request.on('error', (err) => {
      log.error('下载请求失败:', err);
      reject(err);
    });

    request.setTimeout(600000, () => {  // 10 分钟超时
      request.destroy();
      reject(new Error('下载超时'));
    });
  });
}

// 创建主窗口
function createWindow() {
  log.info('创建主窗口...');

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 700,
    title: 'AI智能抠图',
    icon: path.join(assetsPath, 'icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false  // 允许 file:// 加载本地 ONNX 模型
    },
    show: false,
    backgroundColor: '#f5f7fa'
  });

  // 加载页面
  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 准备好后显示窗口
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    log.info('主窗口已显示');
  });

  // 窗口关闭时
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 创建菜单
  createMenu();
}

// 创建菜单
function createMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '打开图片',
          accelerator: 'CmdOrCtrl+O',
          click: () => openFile()
        },
        {
          label: '导出图片',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow?.webContents.send('menu-export')
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '编辑',
      submenu: [
        {
          label: '撤销',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu-undo')
        },
        {
          label: '重新处理',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu-reprocess')
        },
        { type: 'separator' },
        {
          label: '重置',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => mainWindow?.webContents.send('menu-reset')
        }
      ]
    },
    {
      label: '介绍',
      click: () => mainWindow?.webContents.send('show-readme')
    },
    { type: 'separator' },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于',
          click: () => {
            mainWindow?.webContents.send('show-about');
          }
        },
        {
          label: '打开日志文件夹',
          click: () => {
            shell.showItemInFolder(log.transports.file.getFile().path);
          }
        }
      ]
    }
  ];

  // macOS 特殊处理
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    });
  }

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// 打开文件
async function openFile() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择图片',
    filters: [
      { name: '图片文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    properties: ['openFile']
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const filePath = result.filePaths[0];
    log.info('打开文件:', filePath);
    mainWindow?.webContents.send('open-file', filePath);
  }
}

// 处理命令行图片参数
function handleCommandLineImage() {
  const args = process.argv.slice(app.isPackaged ? 1 : 2);
  
  for (const arg of args) {
    // 检查是否是图片文件
    const ext = path.extname(arg).toLowerCase();
    const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.bmp'];
    
    if (imageExts.includes(ext) && fs.existsSync(arg)) {
      log.info('命令行图片参数:', arg);
      // 延迟发送，等窗口准备好
      setTimeout(() => {
        mainWindow?.webContents.send('open-file', arg);
      }, 1000);
      break;
    }
  }
}

// 应用层单例
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  log.warn('已有实例在运行，退出');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 处理第二个实例
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      
      // 检查命令行参数
      const args = commandLine.slice(app.isPackaged ? 1 : 2);
      for (const arg of args) {
        const ext = path.extname(arg).toLowerCase();
        if (['.png', '.jpg', '.jpeg', '.webp', '.bmp'].includes(ext)) {
          mainWindow.webContents.send('open-file', arg);
          break;
        }
      }
    }
  });
}

// App 事件
app.whenReady().then(() => {
  log.info('App 就绪');
  initPaths();
  createWindow();
  
  // 检查模型
  if (!checkModel()) {
    log.info('提示用户下载模型');
    mainWindow?.webContents.send('model-missing');
  }
  
  // 处理命令行参数
  handleCommandLineImage();
});

app.on('window-all-closed', () => {
  log.info('所有窗口已关闭');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('will-quit', () => {
  log.info('应用即将退出');
});

// IPC 处理器
ipcMain.handle('get-model-status', async () => {
  return {
    exists: checkModel(),
    path: modelPath
  };
});

ipcMain.handle('get-model-path', async () => {
  // 直接使用确定存在的路径
  // 打包后 resources/app/assets/bria_rmbg_1.4.onnx
  const modelPath = path.join(__dirname, '..', 'assets', 'bria_rmbg_1.4.onnx');
  
  log.info('get-model-path 返回:', modelPath);
  log.info('文件存在:', fs.existsSync(modelPath));
  
  return modelPath;
});

ipcMain.handle('download-model', async (event) => {
  try {
    await downloadModel((percent, downloaded, total) => {
      event.sender.send('download-progress', {
        percent: parseFloat(percent),
        downloaded: Math.floor(downloaded / 1024 / 1024),
        total: Math.floor(total / 1024 / 1024)
      });
    });
    return { success: true };
  } catch (error) {
    log.error('模型下载失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('open-file-dialog', async () => {
  await openFile();
});

ipcMain.handle('read-image-file', async (event, filePath) => {
  try {
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');
    const ext = path.extname(filePath).toLowerCase().slice(1);
    const mimeTypes = {
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'webp': 'image/webp',
      'bmp': 'image/bmp'
    };
    return {
      success: true,
      dataUrl: `data:${mimeTypes[ext] || 'image/png'};base64,${base64}`,
      path: filePath
    };
  } catch (error) {
    log.error('读取图片失败:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('save-file', async (event, { dataUrl, defaultName }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存图片',
    defaultPath: defaultName || '抠图结果.png',
    filters: [
      { name: 'PNG 图片', extensions: ['png'] },
      { name: 'JPG 图片', extensions: ['jpg'] },
      { name: 'WEBP 图片', extensions: ['webp'] }
    ]
  });

  if (!result.canceled && result.filePath) {
    try {
      const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(result.filePath, buffer);
      log.info('文件保存成功:', result.filePath);
      return { success: true, path: result.filePath };
    } catch (error) {
      log.error('保存失败:', error);
      return { success: false, error: error.message };
    }
  }
  return { success: false, canceled: true };
});

ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-zanzhu-image', async () => {
  // 优先使用项目根目录的 zanzhu.jpg
  const zanzhuPaths = [
    path.join(__dirname, '..', '..', 'zanzhu.jpg'),  // 项目根目录
    path.join(__dirname, '..', 'assets', 'zanzhu.jpg'),  // assets 目录
  ];
  
  for (const zanzhuPath of zanzhuPaths) {
    if (fs.existsSync(zanzhuPath)) {
      log.info('找到赞助图:', zanzhuPath);
      const buffer = fs.readFileSync(zanzhuPath);
      const base64 = buffer.toString('base64');
      return `data:image/jpeg;base64,${base64}`;
    }
  }
  log.warn('未找到赞助图');
  return null;
});

// 检查更新
ipcMain.handle('check-for-updates', async () => {
  try {
    log.info('检查更新...');
    const currentVersion = app.getVersion();
    
    // 从 GitHub 获取最新版本信息
    const https = require('https');
    
    return new Promise((resolve) => {
      const options = {
        hostname: 'api.github.com',
        path: '/repos/zhengqingke-beep/ai-background-remover/releases/latest',
        headers: {
          'User-Agent': 'AI-Background-Remover',
          'Accept': 'application/vnd.github.v3+json'
        }
      };
      
      const req = https.get(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          try {
            const release = JSON.parse(data);
            const latestVersion = release.tag_name.replace('v', '');
            const hasUpdate = latestVersion > currentVersion;
            
            log.info('当前版本:', currentVersion);
            log.info('最新版本:', latestVersion);
            log.info('有更新:', hasUpdate);
            
            resolve({
              currentVersion: currentVersion,
              latestVersion: latestVersion,
              hasUpdate: hasUpdate,
              updateUrl: release.html_url,
              downloadUrl: release.assets[0]?.browser_download_url || '',
              releaseNotes: release.body || '暂无更新说明'
            });
          } catch (e) {
            log.error('解析版本信息失败:', e);
            resolve({
              currentVersion: currentVersion,
              latestVersion: currentVersion,
              hasUpdate: false,
              error: '解析版本信息失败'
            });
          }
        });
      });
      
      req.on('error', (e) => {
        log.error('检查更新失败:', e);
        resolve({
          currentVersion: currentVersion,
          latestVersion: currentVersion,
          hasUpdate: false,
          error: e.message
        });
      });
      
      req.setTimeout(10000, () => {
        req.destroy();
        resolve({
          currentVersion: currentVersion,
          latestVersion: currentVersion,
          hasUpdate: false,
          error: '请求超时'
        });
      });
    });
  } catch (error) {
    log.error('检查更新失败:', error);
    return {
      currentVersion: app.getVersion(),
      latestVersion: app.getVersion(),
      hasUpdate: false,
      error: error.message
    };
  }
});

// 获取联系方式
ipcMain.handle('get-contact-info', async () => {
  return {
    qq: '502753829@qq.com',
    phone: '155 6262 0510',
    wechat: '155 6262 0510',
    officialAccount: '庆科字体'
  };
});

// 监听 macOS open-file 事件
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  log.info('open-file 事件:', filePath);
  if (mainWindow) {
    mainWindow.webContents.send('open-file', filePath);
  }
});

log.info('主进程初始化完成');
