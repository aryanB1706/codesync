import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import SessionTape from '../components/SessionTape';
import './EditorPage.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL
    || (import.meta.env.DEV ? 'http://localhost:5000' : 'https://codesync-backend-sj9z.onrender.com');
const StableEditor = React.memo(Editor);

// === FILE TREE COMPONENT ===
const FileTreeNode = ({
    fileName,
    nodes,
    onSelect,
    onDelete,
    onNewFile,
    activeFileName,
    path,
    locks,
    currentSocketId,
    depth = 0,
}) => {
    const isFolder = nodes !== null;
    const fullPath = path ? `${path}/${fileName}` : fileName;
    const hasActiveChild = isFolder && !!activeFileName && (activeFileName === fullPath || activeFileName.startsWith(`${fullPath}/`));
    const [isOpen, setIsOpen] = useState(hasActiveChild);

    useEffect(() => {
        if (hasActiveChild) setIsOpen(true);
    }, [hasActiveChild]);

    const handleDeleteClick = (e) => {
        e.stopPropagation();
        const confirmMsg = isFolder
            ? `Delete folder "${fileName}" and all its contents?`
            : `Delete file "${fileName}"?`;
        if (window.confirm(confirmMsg)) onDelete(fullPath);
    };

    if (!isFolder) {
        const fileLock = locks[fullPath];
        let lockIndicator = null;
        if (fileLock) {
            if (fileLock.socketId === currentSocketId) {
                lockIndicator = <span className="file-lock file-lockMine" title="You are editing">EDIT</span>;
            } else {
                lockIndicator = <span className="file-lock file-lockOther" title={`Locked by ${fileLock.username}`}>{fileLock.username}</span>;
            }
        }
        return (
            <div
                onClick={() => onSelect(fullPath)}
                className={`fileTree-row fileTree-file ${activeFileName === fullPath ? 'is-active' : ''}`}
                style={{ '--depth': depth }}
                title={fullPath}
            >
                <div className="fileTree-name">
                    <span className={`fileTypeIcon ${getFileIconClass(fileName)}`}>{getFileIcon(fileName)}</span>
                    <span className="fileTree-label">{fileName}</span>
                    {lockIndicator}
                </div>
                <button className="fileTree-action" onClick={handleDeleteClick} title="Delete file">x</button>
            </div>
        );
    }

    return (
        <div className="fileTree-folderGroup">
            <div
                onClick={() => setIsOpen(!isOpen)}
                className={`fileTree-row fileTree-folder ${hasActiveChild ? 'has-active-child' : ''}`}
                style={{ '--depth': depth }}
                title={fullPath}
            >
                <div className="fileTree-name">
                    <span className="folderChevron">{isOpen ? '▾' : '▸'}</span>
                    <span className={`folderIcon ${isOpen ? 'is-open' : ''}`}></span>
                    <span className="fileTree-label">{fileName}</span>
                </div>
                <div className="fileTree-actions">
                    <button
                        className="fileTree-action"
                        onClick={(e) => {
                            e.stopPropagation();
                            onNewFile(fullPath);
                            setIsOpen(true);
                        }}
                        title={`New file in ${fileName}`}
                    >
                        +
                    </button>
                    <button className="fileTree-action" onClick={handleDeleteClick} title="Delete folder">x</button>
                </div>
            </div>
            {isOpen && (
                <div>
                    {Object.keys(nodes).sort((a, b) => {
                        const aIsFolder = nodes[a] !== null;
                        const bIsFolder = nodes[b] !== null;
                        if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
                        return a.localeCompare(b);
                    }).map((childName) => (
                        <FileTreeNode
                            key={childName} fileName={childName} nodes={nodes[childName]}
                            onSelect={onSelect} onDelete={onDelete} activeFileName={activeFileName} path={fullPath}
                            locks={locks} currentSocketId={currentSocketId} onNewFile={onNewFile}
                            depth={depth + 1}
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const getFileIcon = (name) => {
    if (name.endsWith('.html')) return '<>';
    if (name.endsWith('.css')) return '#';
    if (name.endsWith('.js')) return 'JS';
    if (name.endsWith('.jsx')) return 'RX';
    if (name.endsWith('.py')) return 'PY';
    if (name.endsWith('.java')) return 'JV';
    if (name.endsWith('.cpp') || name.endsWith('.c')) return 'C';
    return '';
};

const getFileIconClass = (name) => {
    if (name.endsWith('.html')) return 'is-html';
    if (name.endsWith('.css')) return 'is-css';
    if (name.endsWith('.js')) return 'is-js';
    if (name.endsWith('.jsx')) return 'is-jsx';
    if (name.endsWith('.py')) return 'is-py';
    if (name.endsWith('.java')) return 'is-java';
    if (name.endsWith('.cpp') || name.endsWith('.c')) return 'is-cpp';
    return 'is-default';
};

const getLang = (fileName) => {
    if (fileName.endsWith('.py')) return 'python';
    if (fileName.endsWith('.cpp') || fileName.endsWith('.c')) return 'cpp';
    if (fileName.endsWith('.css')) return 'css';
    if (fileName.endsWith('.html')) return 'html';
    return 'javascript';
};

const getMinimalEdit = (model, nextValue) => {
    const currentValue = model.getValue();
    if (currentValue === nextValue) return null;

    let start = 0;
    const currentLength = currentValue.length;
    const nextLength = nextValue.length;

    while (
        start < currentLength &&
        start < nextLength &&
        currentValue[start] === nextValue[start]
    ) {
        start += 1;
    }

    let currentEnd = currentLength;
    let nextEnd = nextLength;

    while (
        currentEnd > start &&
        nextEnd > start &&
        currentValue[currentEnd - 1] === nextValue[nextEnd - 1]
    ) {
        currentEnd -= 1;
        nextEnd -= 1;
    }

    const startPosition = model.getPositionAt(start);
    const endPosition = model.getPositionAt(currentEnd);

    return {
        range: {
            startLineNumber: startPosition.lineNumber,
            startColumn: startPosition.column,
            endLineNumber: endPosition.lineNumber,
            endColumn: endPosition.column,
        },
        text: nextValue.slice(start, nextEnd),
        forceMoveMarkers: true,
    };
};

const applyTapeEventToFileStore = (fileStore, event) => {
    if (!event?.filePath) return;

    if (event.type === 'FILE_DELETE') {
        Object.keys(fileStore).forEach((fileName) => {
            if (fileName === event.filePath || fileName.startsWith(`${event.filePath}/`)) {
                delete fileStore[fileName];
            }
        });
        return;
    }

    if (event.type === 'FILE_EDIT' || event.type === 'FILE_CREATE') {
        fileStore[event.filePath] = {
            name: event.filePath,
            language: getLang(event.filePath),
            value: event.fullContent || '',
        };
    }
};

const EditorPage = () => {
    const socketRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const navigate = useNavigate();
    const username = location.state?.username;

    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);
    const editorRef = useRef(null);

    // ─── CORE ARCHITECTURE ────────────────────────────────────────────────────
    // filesRef  = ground truth for ALL file contents (never causes re-render)
    // fileKeys  = React state with just the list of filenames (drives sidebar only)
    //
    // This means: typing, remote edits, socket events → ZERO React re-renders
    // on the editor. Only sidebar re-renders when files are added/deleted.
    // ─────────────────────────────────────────────────────────────────────────
    const filesRef = useRef({
        "src/App.js": { name: "src/App.js", language: "javascript", value: "// React App Code\nconsole.log('App Started');" },
        "style.css":  { name: "style.css",  language: "css",        value: "body { background: #000; }" }
    });
    const [fileKeys, setFileKeys] = useState(["src/App.js", "style.css"]);

    const activeFileNameRef = useRef("src/App.js");
    const [activeFileName, setActiveFileName] = useState("src/App.js");

    // Prevents echoing remote changes back to socket
    const isRemoteChangeRef = useRef(false);
    const isReplayingRef = useRef(false);
    const liveFilesBeforeReplayRef = useRef(null);
    // Debounce handle for outgoing emits
    const emitTimerRef = useRef(null);
    const typingStopTimerRef = useRef(null);
    const typingActiveRef = useRef(false);
    const locksRef = useRef({});
    const currentSocketIdRef = useRef(null);

    const [clients, setClients]     = useState([]);
    const [locks, setLocks]         = useState({});
    const [typingUsers, setTypingUsers] = useState({});
    const [currentSocketId, setCurrentSocketId] = useState(null);
    const [showUsers, setShowUsers] = useState(false);
    const [output, setOutput]       = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError]     = useState(false);
    const [sessionTape, setSessionTape] = useState([]);
    const [isReplaying, setIsReplaying] = useState(false);
    const [isCreatingFile, setIsCreatingFile] = useState(false);
    const [newFileBasePath, setNewFileBasePath] = useState('');
    const [newFileName, setNewFileName] = useState('');

    useEffect(() => { activeFileNameRef.current = activeFileName; }, [activeFileName]);
    useEffect(() => { locksRef.current = locks; }, [locks]);
    useEffect(() => { currentSocketIdRef.current = currentSocketId; }, [currentSocketId]);
    useEffect(() => { isReplayingRef.current = isReplaying; }, [isReplaying]);

    useEffect(() => {
        if (!location.state) { toast.error("Username is required"); navigate('/'); }
    }, [location.state, navigate]);

    const cloneCurrentFiles = useCallback(() => {
        const cloned = {};

        Object.entries(filesRef.current).forEach(([fileName, fileData]) => {
            cloned[fileName] = { ...fileData };
        });

        const active = activeFileNameRef.current;
        if (editorRef.current && active && cloned[active] && !isReplayingRef.current) {
            cloned[active].value = editorRef.current.getValue();
        }

        return cloned;
    }, []);

    const applyFileStoreToEditor = useCallback((nextStore, preferredActiveFile) => {
        filesRef.current = nextStore;

        const keys = Object.keys(nextStore);
        const nextActiveFile = keys.includes(preferredActiveFile)
            ? preferredActiveFile
            : keys[0] || "";

        activeFileNameRef.current = nextActiveFile;
        setActiveFileName(nextActiveFile);
        setFileKeys(keys);

        if (editorRef.current) {
            isRemoteChangeRef.current = true;
            editorRef.current.getModel()?.setValue(nextActiveFile ? nextStore[nextActiveFile]?.value || '' : '');
            queueMicrotask(() => {
                isRemoteChangeRef.current = false;
            });
        }
    }, []);

    const applyReplayFiles = useCallback((fileMap) => {
        const replayStore = {};

        Object.entries(fileMap).forEach(([fileName, value]) => {
            replayStore[fileName] = {
                name: fileName,
                language: getLang(fileName),
                value,
            };
        });

        applyFileStoreToEditor(replayStore, activeFileNameRef.current);
    }, [applyFileStoreToEditor]);

    const handleTapeScrub = useCallback((eventIndex) => {
        if (!socketRef.current) return;

        if (!isReplayingRef.current) {
            liveFilesBeforeReplayRef.current = cloneCurrentFiles();
            isReplayingRef.current = true;
            setIsReplaying(true);
        }

        socketRef.current.emit('tape-scrub', { roomId, eventIndex });
    }, [cloneCurrentFiles, roomId]);

    const handleExitReplay = useCallback(() => {
        const liveStore = liveFilesBeforeReplayRef.current || cloneCurrentFiles();
        liveFilesBeforeReplayRef.current = null;
        isReplayingRef.current = false;
        setIsReplaying(false);
        applyFileStoreToEditor(liveStore, activeFileNameRef.current);
        socketRef.current?.emit('lock_file', { roomId, fileName: activeFileNameRef.current || null });
    }, [applyFileStoreToEditor, cloneCurrentFiles, roomId]);

    // ── SOCKET SETUP ─────────────────────────────────────────────────────────
    useEffect(() => {
        if (!username) return undefined;

        let isDisposed = false;

        const initSocket = async () => {
            let userLocation = "Unknown Location";
            try {
                const res = await axios.get('https://ipinfo.io/json');
                userLocation = `${res.data.city}, ${res.data.country}`;
            } catch {
                userLocation = "Unknown Location";
            }

            if (isDisposed) return;

            socketRef.current = io(BACKEND_URL, {
                transports: ['websocket', 'polling'], reconnectionAttempts: 5
            });
            socketRef.current.on('connect', () => {
                const socketId = socketRef.current.id;
                currentSocketIdRef.current = socketId;
                setCurrentSocketId(socketId);
            });
            socketRef.current.on('connect_error', () => toast.error('Socket connection failed'));
            socketRef.current.emit('join', { roomId, username, location: userLocation });
            socketRef.current.emit('request-tape', { roomId });

            socketRef.current.on('joined', ({ clients, username: joinedUsername, locks }) => {
                if (joinedUsername !== username) toast.success(`${joinedUsername} joined.`);
                setClients(clients);
                if (locks) {
                    locksRef.current = locks;
                    setLocks(locks);
                }
                if (joinedUsername === username) {
                    socketRef.current?.emit('lock_file', { roomId, fileName: activeFileNameRef.current });
                }
            });

            socketRef.current.on('locks_updated', (updatedLocks) => {
                locksRef.current = updatedLocks || {};
                setLocks(updatedLocks || {});
            });
            socketRef.current.on('typing_updated', (typing) => setTypingUsers(typing || {}));

            socketRef.current.on('lock_denied', ({ fileName, lock }) => {
                toast.error(`${fileName} is already being edited by ${lock.username}`);
            });

            // ── REMOTE CODE CHANGE ───────────────────────────────────────────
            // This is the most important handler.
            // Rule: setState is NEVER called here. Only update the ref and, if
            // the file is currently open, patch the Monaco model surgically.
            socketRef.current.on('code_change', ({ fileName, code }) => {
                if (isReplayingRef.current) return;

                // 1. Always sync ref (background files stay up-to-date for zip/run)
                if (filesRef.current[fileName]) {
                    filesRef.current[fileName].value = code;
                }

                // 2. Only touch editor DOM if this file is actually open right now
                if (!editorRef.current || activeFileNameRef.current !== fileName) return;

                const model = editorRef.current.getModel();
                if (!model || model.getValue() === code) return;

                // Block our own onChange from re-emitting this change
                isRemoteChangeRef.current = true;

                // Cursor preservation ke liye tumhara function
                const edit = getMinimalEdit(model, code);

                try {
                    if (edit) {
                        // Direct model pe apply karo (bypasses readOnly)
                        model.applyEdits([edit]);
                    }
                } finally {
                    queueMicrotask(() => {
                        isRemoteChangeRef.current = false;
                    });
                }
            });

            socketRef.current.on('file_created', ({ fileName, language, value }) => {
                if (isReplayingRef.current) return;

                filesRef.current[fileName] = { name: fileName, language, value };
                setFileKeys(Object.keys(filesRef.current));
            });

            socketRef.current.on('file_deleted', ({ id }) => {
                if (isReplayingRef.current) return;

                Object.keys(filesRef.current).forEach(k => {
                    if (k === id || k.startsWith(id + '/')) delete filesRef.current[k];
                });
                setFileKeys(Object.keys(filesRef.current));
            });

            socketRef.current.on('tape-snapshot', (tape) => {
                setSessionTape(tape || []);
            });

            socketRef.current.on('tape-new-event', (event) => {
                if (!event) return;

                setSessionTape(prev => {
                    if (prev.some(item => item.eventIndex === event.eventIndex)) return prev;
                    return [...prev, event];
                });

                if (isReplayingRef.current && liveFilesBeforeReplayRef.current) {
                    applyTapeEventToFileStore(liveFilesBeforeReplayRef.current, event);
                }
            });

            socketRef.current.on('tape-state-at', ({ files }) => {
                applyReplayFiles(files || {});
            });

            socketRef.current.on('disconnected', ({ socketId, username }) => {
                toast.success(`${username} left.`);
                setClients(prev => prev.filter(c => c.socketId !== socketId));
            });
        };

        initSocket();
        return () => {
            isDisposed = true;
            clearTimeout(emitTimerRef.current);
            clearTimeout(typingStopTimerRef.current);
            typingActiveRef.current = false;
            socketRef.current?.emit('typing_stop', { roomId, fileName: activeFileNameRef.current });
            socketRef.current?.emit('lock_file', { roomId, fileName: null });
            socketRef.current?.disconnect();
        };
    }, [applyReplayFiles, roomId, username]);

    // ── EDITOR MOUNT ─────────────────────────────────────────────────────────
    const handleEditorDidMount = useCallback((editor) => {
        editorRef.current = editor;
    }, []);

    // ── FILE SELECT (TAB SWITCH) ─────────────────────────────────────────────
    const handleFileSelect = useCallback((path) => {
        const previousFileName = activeFileNameRef.current;

        // Persist current editor value to ref before switching away
        if (editorRef.current && activeFileNameRef.current && filesRef.current[activeFileNameRef.current]) {
            filesRef.current[activeFileNameRef.current].value = editorRef.current.getValue();
        }

        clearTimeout(typingStopTimerRef.current);
        typingActiveRef.current = false;
        if (previousFileName) {
            socketRef.current?.emit('typing_stop', { roomId, fileName: previousFileName });
        }

        activeFileNameRef.current = path;
        setActiveFileName(path);

        // Directly load new file into editor — intentional setValue, cursor reset is fine here
        if (editorRef.current && filesRef.current[path]) {
            isRemoteChangeRef.current = true;
            editorRef.current.getModel()?.setValue(filesRef.current[path].value);
            isRemoteChangeRef.current = false;
        }

        if (!isReplayingRef.current) {
            socketRef.current?.emit('lock_file', { roomId, fileName: path });
        }
    }, [roomId]);

    const handleRequestLock = useCallback(() => {
        const fileName = activeFileNameRef.current;
        if (!fileName) return;
        socketRef.current?.emit('lock_file', { roomId, fileName });
    }, [roomId]);

    const handleReleaseLock = useCallback(() => {
        const fileName = activeFileNameRef.current;
        if (!fileName) return;
        clearTimeout(typingStopTimerRef.current);
        typingActiveRef.current = false;
        socketRef.current?.emit('typing_stop', { roomId, fileName });
        socketRef.current?.emit('lock_file', { roomId, fileName: null });
    }, [roomId]);

    // ── TYPING ───────────────────────────────────────────────────────────────
    // NO setState. Only update ref + debounced socket emit.
    // This is why there's zero flicker when you type.
    const handleEditorChange = useCallback((value) => {
        if (isRemoteChangeRef.current) return;
        if (isReplayingRef.current) return;

        const fileName = activeFileNameRef.current;
        if (!fileName || !filesRef.current[fileName]) return;

        const code = value ?? '';
        filesRef.current[fileName].value = code;

        if (locksRef.current[fileName]?.socketId !== currentSocketIdRef.current) return;

        if (!typingActiveRef.current) {
            typingActiveRef.current = true;
            socketRef.current?.emit('typing_start', { roomId, fileName });
        }

        clearTimeout(typingStopTimerRef.current);
        typingStopTimerRef.current = setTimeout(() => {
            typingActiveRef.current = false;
            socketRef.current?.emit('typing_stop', { roomId, fileName });
        }, 1200);

        clearTimeout(emitTimerRef.current);
        emitTimerRef.current = setTimeout(() => {
            socketRef.current?.emit('code_change', { roomId, fileName, code });
        }, 30);
    }, [roomId]);

    // ── HELPERS ───────────────────────────────────────────────────────────────
    const buildFileTree = (keys) => {
        const root = {};
        keys.forEach((path) => {
            const parts = path.split('/');
            let cur = root;
            parts.forEach((p, i) => {
                if (i === parts.length - 1) cur[p] = null;
                else { cur[p] = cur[p] || {}; cur = cur[p]; }
            });
        });
        return root;
    };

    const handleDeleteNode = useCallback((pathToDelete) => {
        if (isReplayingRef.current) {
            toast.error("Exit replay mode before deleting files.");
            return;
        }

        Object.keys(filesRef.current).forEach(k => {
            if (k === pathToDelete || k.startsWith(pathToDelete + '/')) delete filesRef.current[k];
        });
        setFileKeys(Object.keys(filesRef.current));
        socketRef.current?.emit('file_deleted', { roomId, id: pathToDelete });
        if (activeFileNameRef.current === pathToDelete || activeFileNameRef.current.startsWith(pathToDelete + '/')) {
            activeFileNameRef.current = "";
            setActiveFileName("");
            typingActiveRef.current = false;
            socketRef.current?.emit('typing_stop', { roomId, fileName: pathToDelete });
            socketRef.current?.emit('lock_file', { roomId, fileName: null });
        }
    }, [roomId]);

    const renderTree = (node, path = '') =>
        Object.keys(node).sort((a, b) => {
            const aIsFolder = node[a] !== null;
            const bIsFolder = node[b] !== null;
            if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
            return a.localeCompare(b);
        }).map(key => (
            <FileTreeNode
                key={key} fileName={key} nodes={node[key]} path={path}
                onSelect={handleFileSelect} onDelete={handleDeleteNode}
                activeFileName={activeFileName}
                locks={locks} currentSocketId={currentSocketId}
                onNewFile={startCreateNewFile}
            />
        ));

    const processFile = (file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            const fp = file.webkitRelativePath || file.name;
            resolve({ name: fp, language: getLang(fp), value: ev.target.result });
        };
        reader.readAsText(file);
    });

    const handleUpload = async (e) => {
        if (isReplayingRef.current) {
            toast.error("Exit replay mode before uploading files.");
            e.target.value = '';
            return;
        }

        if (!e.target.files) return;
        for (const file of e.target.files) {
            if (file.name === '.DS_Store') continue;
            const fd = await processFile(file);
            filesRef.current[fd.name] = fd;
            socketRef.current?.emit('file_created', { roomId, fileName: fd.name, language: fd.language, value: fd.value });
        }
        setFileKeys(Object.keys(filesRef.current));
        toast.success("Uploaded successfully!");
    };

    const startCreateNewFile = useCallback((basePath = '') => {
        if (isReplayingRef.current) {
            toast.error("Exit replay mode before creating files.");
            return;
        }

        setNewFileBasePath(basePath);
        setNewFileName('');
        setIsCreatingFile(true);
    }, []);

    const cancelCreateNewFile = useCallback(() => {
        setIsCreatingFile(false);
        setNewFileBasePath('');
        setNewFileName('');
    }, []);

    const createNewFile = useCallback((filePath) => {
        const fileName = filePath
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\/|\/$/g, '')
            .trim();

        if (!fileName || filesRef.current[fileName]) return;
        const nf = { name: fileName, language: getLang(fileName), value: `// ${fileName}` };
        filesRef.current[fileName] = nf;
        setFileKeys(Object.keys(filesRef.current));
        handleFileSelect(fileName);
        socketRef.current?.emit('file_created', { roomId, fileName, language: nf.language, value: nf.value });
        toast.success(`${fileName} created`);
    }, [handleFileSelect, roomId]);

    const submitNewFile = useCallback((e) => {
        e.preventDefault();

        if (isReplayingRef.current) {
            toast.error("Exit replay mode before creating files.");
            return;
        }

        const nextPath = newFileBasePath
            ? `${newFileBasePath}/${newFileName}`
            : newFileName;
        const normalizedPath = nextPath
            .replace(/\\/g, '/')
            .replace(/\/+/g, '/')
            .replace(/^\/|\/$/g, '')
            .trim();

        if (!normalizedPath) return;
        if (filesRef.current[normalizedPath]) {
            toast.error("File already exists.");
            return;
        }

        createNewFile(normalizedPath);
        cancelCreateNewFile();
    }, [cancelCreateNewFile, createNewFile, newFileBasePath, newFileName]);

    const runCode = async () => {
        setIsLoading(true); setIsError(false);
        const fn = activeFileNameRef.current;
        const currentFile = filesRef.current[fn];
        if (!currentFile) { toast.error("No file selected!"); setIsLoading(false); return; }
        const latestValue = editorRef.current?.getValue() ?? currentFile.value;
        const filesArray = Object.values(filesRef.current).map(f =>
            f.name === fn ? { ...f, value: latestValue } : f
        );
        try {
            const res = await axios.post(`${BACKEND_URL}/execute`, {
                files: filesArray, mainFile: { ...currentFile, value: latestValue }, language: currentFile.language
            });
            const r = res.data.run;
            if (r.signal) { setOutput(`Error: ${r.signal}`); setIsError(true); }
            else { setOutput(r.output || r.stderr || "No Output"); if (r.stderr) setIsError(true); }
        } catch { setOutput("Error: Failed to execute code."); setIsError(true); }
        finally { setIsLoading(false); }
    };

    const downloadZip = async () => {
        if (editorRef.current && activeFileNameRef.current) {
            filesRef.current[activeFileNameRef.current].value = editorRef.current.getValue();
        }
        const zip = new JSZip();
        Object.values(filesRef.current).forEach(f => zip.file(f.name, f.value));
        saveAs(await zip.generateAsync({ type: "blob" }), "CodeSync_Project.zip");
        toast.success("Project downloaded!");
    };

    const fileTree    = buildFileTree(fileKeys);
    const currentLock = locks[activeFileName];
    const hasMyLock   = !!(currentLock && currentLock.socketId === currentSocketId);
    const isReadOnly  = !!activeFileName && !hasMyLock;
    const currentTyping = typingUsers[activeFileName];
    const isOtherTyping = !!(currentTyping && currentTyping.socketId !== currentSocketId);
    const editorPath = activeFileName || "untitled.js";
    const editorLanguage = useMemo(
        () => filesRef.current[activeFileName]?.language || "javascript",
        [activeFileName]
    );
    const editorInitialValue = useMemo(
        () => filesRef.current[activeFileName]?.value || "",
        [activeFileName]
    );
    const editorOptions = useMemo(() => ({
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true,
        readOnly: isReadOnly || isReplaying,
        domReadOnly: isReadOnly || isReplaying,
        renderWhitespace: 'none',
        renderControlCharacters: false,
    }), [isReadOnly, isReplaying]);

    if (!location.state) return null;

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden' }}>

            {/* Header */}
            <div style={{ height: '50px', background: '#333333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 15px', borderBottom: '1px solid #252526' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ background: '#4aed88', width: '20px', height: '20px', borderRadius: '4px' }}></div>
                    <span style={{ fontWeight: '600', color: '#ccc', letterSpacing: '1px' }}>CodeSync Pro</span>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <div style={{ position: 'relative' }}>
                        <button onClick={() => setShowUsers(p => !p)}
                            style={{ background: '#444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                            👥 Users ({clients.length})
                        </button>
                        {showUsers && (
                            <div style={{ position: 'absolute', top: '35px', right: '0', background: '#252526', border: '1px solid #444', borderRadius: '6px', width: '250px', zIndex: 10, padding: '10px', boxShadow: '0 4px 10px rgba(0,0,0,0.5)' }}>
                                <div style={{ fontSize: '11px', color: '#888', marginBottom: '8px', fontWeight: 'bold' }}>ACTIVE MEMBERS</div>
                                {clients.map(client => (
                                    <div key={client.socketId} style={{ display: 'flex', flexDirection: 'column', padding: '5px 0', borderBottom: '1px solid #333' }}>
                                        <div style={{ color: '#4aed88', fontSize: '13px', fontWeight: 'bold' }}>{client.username} {client.socketId === currentSocketId ? '(You)' : ''}</div>
                                        <div style={{ color: '#aaa', fontSize: '11px' }}>📍 {client.location || 'Unknown'}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <button onClick={downloadZip} style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>📥 Zip</button>
                    <button onClick={() => { navigator.clipboard.writeText(roomId); toast.success('Room ID copied'); }}
                        style={{ background: '#444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>Copy ID</button>
                </div>
            </div>

            {/* Main Workspace */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden', paddingBottom: '70px' }}>

                {/* Sidebar */}
                <div className="editorSidebar">
                    <div className="activityRail">
                        <button className="activityButton is-active" title="Explorer">E</button>
                        <button className="activityButton" title="Search">S</button>
                        <button className="activityButton" title="Session">T</button>
                    </div>

                    <div className="explorerPanel">
                        <div className="explorerTitlebar">
                            <span>EXPLORER</span>
                            <div className="explorerActions">
                                <button disabled={isReplaying} onClick={() => startCreateNewFile()} className="iconButton" title="New file">+</button>
                                <button disabled={isReplaying} onClick={() => fileInputRef.current?.click()} className="iconButton" title="Upload file">↑</button>
                                <button disabled={isReplaying} onClick={() => folderInputRef.current?.click()} className="iconButton" title="Upload folder">▣</button>
                            </div>
                        </div>

                        <div className="workspaceHeader">
                            <span className="workspaceChevron">▾</span>
                            <span className="workspaceName">CODESYNC PROJECT</span>
                            <span className="workspaceCount">{fileKeys.length}</span>
                        </div>

                        <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleUpload} />
                        <input type="file" ref={folderInputRef} webkitdirectory="" directory="" style={{ display: 'none' }} onChange={handleUpload} />

                        {isCreatingFile && (
                            <form className="newFileForm" onSubmit={submitNewFile}>
                                {newFileBasePath && <span className="newFileBase">{newFileBasePath}/</span>}
                                <input
                                    autoFocus
                                    value={newFileName}
                                    onChange={(e) => setNewFileName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Escape') cancelCreateNewFile();
                                    }}
                                    placeholder={newFileBasePath ? 'file.js' : 'src/file.js'}
                                    className="newFileInput"
                                />
                                <button type="submit" className="newFileSubmit" title="Create file">✓</button>
                                <button type="button" onClick={cancelCreateNewFile} className="newFileCancel" title="Cancel">x</button>
                            </form>
                        )}

                        <div className="fileTree">
                            {fileKeys.length ? renderTree(fileTree) : (
                                <div className="emptyExplorer">
                                    <button disabled={isReplaying} onClick={() => startCreateNewFile()} className="emptyExplorerAction">
                                        Create your first file
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {/* Editor + Output */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
                    <div style={{ height: '35px', background: '#1e1e1e', display: 'flex', borderBottom: '1px solid #333', justifyContent: 'space-between' }}>
                        <div className="editorTab">
                            {activeFileName ? (
                                <>
                                    <span className={`fileTypeIcon ${getFileIconClass(activeFileName)}`}>{getFileIcon(activeFileName)}</span>
                                    {activeFileName.split('/').pop()}
                                </>
                            ) : "No File Selected"}
                        </div>
                        {activeFileName && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 15px', color: '#cfcfcf', fontSize: '12px', fontWeight: 'bold' }}>
                                {currentLock ? (
                                    currentLock.socketId === currentSocketId ? (
                                        <>
                                            <span style={{ color: '#4aed88' }}>✏️ You are editing</span>
                                            <button
                                                onClick={handleReleaseLock}
                                                disabled={isReplaying}
                                                style={{ background: '#3a3a3a', color: '#fff', border: '1px solid #555', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' }}
                                            >
                                                Unlock
                                            </button>
                                        </>
                                    ) : (
                                        <span style={{ color: isOtherTyping ? '#fbbf24' : '#f14c4c' }}>
                                            {isOtherTyping ? `${currentTyping.username} is typing...` : `🔒 Locked by ${currentLock.username} (View Only)`}
                                        </span>
                                    )
                                ) : (
                                    <>
                                        <span style={{ color: '#aaa' }}>View only</span>
                                        <button
                                            onClick={handleRequestLock}
                                            disabled={isReplaying}
                                            style={{ background: '#0e639c', color: '#fff', border: 'none', padding: '3px 8px', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}
                                        >
                                            Lock to edit
                                        </button>
                                    </>
                                )}
                            </div>
                        )}
                    </div>

                    <div style={{ flex: 1, position: 'relative' }}>
                        {activeFileName ? (
                            <StableEditor
                                height="100%" width="100%"
                                theme="vs-dark"
                                path={editorPath}
                                defaultLanguage={editorLanguage}
                                defaultValue={editorInitialValue}
                                onChange={handleEditorChange}
                                onMount={handleEditorDidMount}
                                options={editorOptions}
                            />
                        ) : (
                            <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555' }}>
                                Select a file to edit
                            </div>
                        )}
                    </div>

                    <div style={{ height: '200px', background: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '5px 15px', fontSize: '11px', color: '#aaa', borderBottom: '1px solid #2d2d2d', fontWeight: 'bold', display: 'flex', justifyContent: 'space-between' }}>
                            <span>OUTPUT</span>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                {output && <span onClick={() => setOutput("")} style={{ cursor: 'pointer', color: '#fff' }}>🗑️ Clear</span>}
                                <button onClick={runCode} disabled={isLoading || !activeFileName}
                                    style={{ padding: '2px 10px', background: isLoading ? '#555' : '#0e639c', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '11px' }}>
                                    {isLoading ? "Running..." : "▶ Run"}
                                </button>
                            </div>
                        </div>
                        <pre style={{ flex: 1, padding: '10px 15px', margin: 0, fontFamily: "'Fira Code', monospace", fontSize: '14px', color: isError ? '#f87171' : '#a7f3d0', whiteSpace: 'pre-wrap', overflowY: 'auto' }}>
                            {output || <span style={{ color: '#555', fontStyle: 'italic' }}>Output window...</span>}
                        </pre>
                    </div>
                </div>
            </div>
            <SessionTape
                tape={sessionTape}
                onScrub={handleTapeScrub}
                isReplaying={isReplaying}
                onExitReplay={handleExitReplay}
            />
        </div>
    );
};

export default EditorPage;
