const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('jarvis', {
  docs: {
    list: () => ipcRenderer.invoke('docs:list'),
    create: (title) => ipcRenderer.invoke('docs:create', title),
    createBranch: (parentId, title) => ipcRenderer.invoke('docs:createBranch', { parentId, title }),
    remove: (id) => ipcRenderer.invoke('docs:delete', id),
    path: (id) => ipcRenderer.invoke('docs:path', id),
    read: (id) => ipcRenderer.invoke('docs:read', id),
    write: (id, content, base) => ipcRenderer.invoke('docs:write', { id, content, base }),
    convertToMd: (id, content) => ipcRenderer.invoke('docs:convertToMd', { id, content }),
    getOrder: () => ipcRenderer.invoke('docs:getOrder'),
    projectsMap: () => ipcRenderer.invoke('docs:projectsMap'),
    setOrder: (group, ids) => ipcRenderer.invoke('docs:setOrder', { group, ids }),
    getProject: (id) => ipcRenderer.invoke('docs:getProject', id),
    pickProject: (id) => ipcRenderer.invoke('docs:pickProject', id),
    clearProject: (id) => ipcRenderer.invoke('docs:clearProject', id),
    reveal: (id) => ipcRenderer.invoke('docs:reveal', id),
    rename: (id, title) => ipcRenderer.invoke('docs:rename', { id, title }),
  },
  reco: {
    resolve: (id, action) => ipcRenderer.invoke('reco:resolve', { id, action }),
  },
  bench: {
    resolve: (id, action, comment) => ipcRenderer.invoke('bench:resolve', { id, action, comment }),
    acceptedCounts: () => ipcRenderer.invoke('bench:acceptedCounts'),
  },
  app: {
    toggleFullscreen: () => ipcRenderer.invoke('app:toggleFullscreen'),
  },
  find: {
    start: (text, forward, findNext) => ipcRenderer.invoke('find:start', { text, forward, findNext }),
    stop: () => ipcRenderer.invoke('find:stop'),
  },
  events: {
    onFindResult: (cb) => ipcRenderer.on('find:result', (_e, r) => cb(r)),
    onAutoCreated: (cb) => ipcRenderer.on('docs:autocreated', (_e, list) => cb(list)),
    onNotice: (cb) => ipcRenderer.on('app:notice', (_e, msg) => cb(msg)),
    onNightBriefing: (cb) => ipcRenderer.on('night:briefing', (_e, info) => cb(info)),
    ackNightBriefing: () => ipcRenderer.invoke('night:ackBriefing'),
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
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    pickRoot: () => ipcRenderer.invoke('projects:pickRoot'),
    toggle: (name, tracked) => ipcRenderer.invoke('projects:toggle', { name, tracked }),
  },
})
