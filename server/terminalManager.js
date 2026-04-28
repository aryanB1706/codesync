const os = require('os');
const pty = require('node-pty');
const { ensureWorkspace } = require('./workspaceManager');

const terminals = new Map();

const getShell = () => {
    if (process.platform === 'win32') {
        return process.env.COMSPEC || 'powershell.exe';
    }
    return process.env.SHELL || 'bash';
};

const getTerminal = (io, roomId) => {
    if (terminals.has(roomId)) {
        return terminals.get(roomId);
    }

    const shell = getShell();
    const workspacePath = ensureWorkspace(roomId);
    const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: workspacePath,
        env: {
            ...process.env,
            TERM: 'xterm-256color',
            CODESYNC_ROOM: roomId,
            CODESYNC_WORKSPACE: workspacePath,
        },
    });

    ptyProcess.onData((data) => {
        io.to(roomId).emit('terminal:data', data);
    });

    ptyProcess.onExit(() => {
        terminals.delete(roomId);
        io.to(roomId).emit('terminal:data', os.EOL + '[terminal exited]' + os.EOL);
    });

    const terminal = { ptyProcess };
    terminals.set(roomId, terminal);
    return terminal;
};

const ensureTerminal = (io, roomId) => {
    if (!roomId) return null;
    return getTerminal(io, roomId);
};

const writeToTerminal = (io, roomId, data) => {
    if (!roomId || typeof data !== 'string') return;
    ensureTerminal(io, roomId)?.ptyProcess.write(data);
};

const resizeTerminal = (io, roomId, cols, rows) => {
    const width = Number(cols);
    const height = Number(rows);
    if (!roomId || !Number.isFinite(width) || !Number.isFinite(height)) return;
    ensureTerminal(io, roomId)?.ptyProcess.resize(
        Math.max(2, Math.floor(width)),
        Math.max(1, Math.floor(height))
    );
};

const closeTerminalIfRoomEmpty = (io, roomId) => {
    if (!roomId || !terminals.has(roomId)) return;

    const room = io.sockets.adapter.rooms.get(roomId);
    if (room && room.size > 0) return;

    const terminal = terminals.get(roomId);
    terminals.delete(roomId);
    terminal.ptyProcess.kill();
};

module.exports = {
    ensureTerminal,
    writeToTerminal,
    resizeTerminal,
    closeTerminalIfRoomEmpty,
};
