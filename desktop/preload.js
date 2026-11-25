const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lumiDesktop', {
  isDesktop: true,
  update: () => ipcRenderer.invoke('lumi:update'),
  retry: () => ipcRenderer.invoke('lumi:retry'),
});
