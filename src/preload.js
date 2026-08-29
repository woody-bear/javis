const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  docs: {
    list: () => ipcRenderer.invoke('docs:list'),
    create: (title) => ipcRenderer.invoke('docs:create', title),
    createBranch: (parentId, title) => ipcRenderer.invoke('docs:createBranch', { parentId, title }),
    remove: (id) => ipcRenderer.invoke('docs:delete', id),
    path: (id) => ipcRenderer.invoke('docs:path', id),
    read: (id) => ipcRenderer.invoke('docs:read', id),
    write: (id, content) => ipcRenderer.invoke('docs:write', { id, content }),
    convertToMd: (id, content) => ipcRenderer.invoke('docs:convertToMd', { id, content }),
    getOrder: () => ipcRenderer.invoke('docs:getOrder'),
    setOrder: (group, ids) => ipcRenderer.invoke('docs:setOrder', { group, ids }),
    getProject: (id) => ipcRenderer.invoke('docs:getProject', id),
    pickProject: (id) => ipcRenderer.invoke('docs:pickProject', id),
    clearProject: (id) => ipcRenderer.invoke('docs:clearProject', id),
    reveal: (id) => ipcRenderer.invoke('docs:reveal', id),
  },
  events: {
    onAutoCreated: (cb) => ipcRenderer.on('docs:autocreated', (_e, list) => cb(list)),
    onNotice: (cb) => ipcRenderer.on('app:notice', (_e, msg) => cb(msg)),
  },
  chat: {
    send: (docId, text) => ipcRenderer.invoke('chat:send', { docId, text }),
    busy: () => ipcRenderer.invoke('chat:busy'),
    abort: () => ipcRenderer.invoke('chat:abort'),
    onEvent: (cb) => ipcRenderer.on('chat:event', (_e, ev) => cb(ev)),
  },
  stt: {
    transcribe: (wav) => ipcRenderer.invoke('stt:transcribe', wav),
    ready: () => ipcRenderer.invoke('stt:ready'),
  },
  tts: { stop: () => ipcRenderer.invoke('tts:stop') },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    pickProject: () => ipcRenderer.invoke('config:pickProject'),
  },
})
