/**
 * AI智能抠图 - 预加载脚本
 */

const { contextBridge, ipcRenderer, shell } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // 模型相关
  getModelStatus: () => ipcRenderer.invoke('get-model-status'),
  getModelPath: () => ipcRenderer.invoke('get-model-path'),
  downloadModel: () => ipcRenderer.invoke('download-model'),
  onDownloadProgress: (callback) => {
    ipcRenderer.on('download-progress', (event, data) => callback(data));
  },
  onModelMissing: (callback) => {
    ipcRenderer.on('model-missing', () => callback());
  },

  // 文件操作
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  readImageFile: (filePath) => ipcRenderer.invoke('read-image-file', filePath),
  saveFile: (dataUrl, defaultName) => ipcRenderer.invoke('save-file', { dataUrl, defaultName }),

  // 菜单命令
  onMenuExport: (callback) => {
    ipcRenderer.on('menu-export', () => callback());
  },
  onMenuUndo: (callback) => {
    ipcRenderer.on('menu-undo', () => callback());
  },
  onMenuReprocess: (callback) => {
    ipcRenderer.on('menu-reprocess', () => callback());
  },
  onMenuReset: (callback) => {
    ipcRenderer.on('menu-reset', () => callback());
  },
  onOpenFile: (callback) => {
    ipcRenderer.on('open-file', (event, filePath) => callback(filePath));
  },
  onShowAbout: (callback) => {
    ipcRenderer.on('show-about', () => callback());
  },
  onShowReadme: (callback) => {
    ipcRenderer.on('show-readme', () => callback());
  },
  getZanzhuImage: () => ipcRenderer.invoke('get-zanzhu-image'),

  // 应用信息
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // 更新检查
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  getContactInfo: () => ipcRenderer.invoke('get-contact-info'),
  
  // 外部链接
  openExternal: (url) => shell.openExternal(url)
});

console.log('预加载脚本已加载');
