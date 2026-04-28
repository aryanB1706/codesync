const fs = require('fs');
const os = require('os');
const path = require('path');
const chokidar = require('chokidar');
const { deleteFileState, getRoomSnapshot, setFileText } = require('./ot');

const WORKSPACES_ROOT = path.join(os.tmpdir(), 'codesync-workspaces');
const MAX_FILE_BYTES = 1024 * 1024;
const rooms = new Map();

const DEFAULT_FILES = {
    'src/App.js': "// React App Code\nconsole.log('App Started');",
    'style.css': 'body { background: #000; }',
};

const safeRoomName = (roomId) => {
    return String(roomId || 'default').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'default';
};

const normalizeRelativePath = (relativePath) => {
    const normalized = path.posix.normalize(String(relativePath || '').replace(/\\/g, '/'));
    if (!normalized || normalized === '.' || normalized.startsWith('../') || path.isAbsolute(normalized)) {
        return null;
    }
    return normalized;
};

const getWorkspacePath = (roomId) => {
    return path.join(WORKSPACES_ROOT, safeRoomName(roomId));
};

const ensureWorkspace = (roomId) => {
    const workspacePath = getWorkspacePath(roomId);
    fs.mkdirSync(workspacePath, { recursive: true });

    const hasEntries = fs.readdirSync(workspacePath).length > 0;
    if (!hasEntries) {
        Object.entries(DEFAULT_FILES).forEach(([fileName, value]) => {
            const filePath = path.join(workspacePath, fileName);
            fs.mkdirSync(path.dirname(filePath), { recursive: true });
            fs.writeFileSync(filePath, value, 'utf8');
        });
    }

    return workspacePath;
};

const shouldIgnorePath = (absolutePath) => {
    const parts = absolutePath.split(path.sep);
    return parts.includes('node_modules')
        || parts.includes('.git')
        || parts.includes('dist')
        || parts.includes('build');
};

const isTextBuffer = (buffer) => !buffer.includes(0);

const walkWorkspace = (root, current = root, snapshot = { files: {}, folders: [] }) => {
    if (!fs.existsSync(current)) return snapshot;

    fs.readdirSync(current, { withFileTypes: true }).forEach((entry) => {
        const absolutePath = path.join(current, entry.name);
        if (shouldIgnorePath(absolutePath)) return;

        const relativePath = path.relative(root, absolutePath).replace(/\\/g, '/');
        if (!relativePath) return;

        if (entry.isDirectory()) {
            snapshot.folders.push(relativePath);
            walkWorkspace(root, absolutePath, snapshot);
            return;
        }

        if (!entry.isFile()) return;

        const stat = fs.statSync(absolutePath);
        if (stat.size > MAX_FILE_BYTES) return;

        const buffer = fs.readFileSync(absolutePath);
        if (!isTextBuffer(buffer)) return;

        snapshot.files[relativePath] = buffer.toString('utf8');
    });

    snapshot.folders.sort();
    return snapshot;
};

const getWorkspaceSnapshot = (roomId) => {
    const workspacePath = ensureWorkspace(roomId);
    return walkWorkspace(workspacePath);
};

const applySnapshotToOt = (roomId, snapshot) => {
    const currentSnapshot = getRoomSnapshot(roomId);
    Object.entries(snapshot.files).forEach(([fileName, value]) => {
        if (currentSnapshot[fileName]?.text !== value) {
            setFileText(roomId, fileName, value);
        }
    });

    Object.keys(currentSnapshot).forEach((fileName) => {
        if (!Object.prototype.hasOwnProperty.call(snapshot.files, fileName)) {
            deleteFileState(roomId, fileName);
        }
    });
};

const emitWorkspaceSync = (io, roomId) => {
    const snapshot = getWorkspaceSnapshot(roomId);
    applySnapshotToOt(roomId, snapshot);
    io.to(roomId).emit('filesystem:sync', snapshot);
    return snapshot;
};

const ensureWorkspaceWatcher = (io, roomId) => {
    if (rooms.has(roomId)) return rooms.get(roomId);

    const workspacePath = ensureWorkspace(roomId);
    let syncTimer = null;
    const scheduleSync = () => {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => emitWorkspaceSync(io, roomId), 120);
    };

    const watcher = chokidar.watch(workspacePath, {
        ignoreInitial: true,
        ignored: (watchedPath) => shouldIgnorePath(watchedPath),
        awaitWriteFinish: {
            stabilityThreshold: 120,
            pollInterval: 40,
        },
    });

    watcher
        .on('add', scheduleSync)
        .on('change', scheduleSync)
        .on('unlink', scheduleSync)
        .on('addDir', scheduleSync)
        .on('unlinkDir', scheduleSync);

    const roomState = { watcher, workspacePath };
    rooms.set(roomId, roomState);
    return roomState;
};

const writeWorkspaceFile = (roomId, relativePath, value = '') => {
    const safePath = normalizeRelativePath(relativePath);
    if (!safePath) return;

    const workspacePath = ensureWorkspace(roomId);
    const filePath = path.join(workspacePath, safePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, value || '', 'utf8');
};

const deleteWorkspacePath = (roomId, relativePath) => {
    const safePath = normalizeRelativePath(relativePath);
    if (!safePath) return;

    const targetPath = path.join(ensureWorkspace(roomId), safePath);
    if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
};

const closeWorkspaceIfRoomEmpty = async (io, roomId) => {
    if (!roomId || !rooms.has(roomId)) return;

    const room = io.sockets.adapter.rooms.get(roomId);
    if (room && room.size > 0) return;

    const roomState = rooms.get(roomId);
    rooms.delete(roomId);
    await roomState.watcher.close();
};

module.exports = {
    closeWorkspaceIfRoomEmpty,
    deleteWorkspacePath,
    emitWorkspaceSync,
    ensureWorkspace,
    ensureWorkspaceWatcher,
    getWorkspacePath,
    getWorkspaceSnapshot,
    writeWorkspaceFile,
};
