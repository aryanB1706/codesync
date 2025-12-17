import React, { useEffect, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

// === FILE TREE COMPONENT (Updated with Delete) ===
const FileTreeNode = ({ fileName, nodes, onSelect, onDelete, activeFileName, path }) => {
    const isFolder = nodes !== null;
    const [isOpen, setIsOpen] = useState(false);

    // Full path calculate karo (recursion ke liye zaroori hai)
    const fullPath = path ? `${path}/${fileName}` : fileName;

    // Delete Button Click Handler
    const handleDeleteClick = (e) => {
        e.stopPropagation(); // Folder open/close hone se roko
        
        const confirmMsg = isFolder 
            ? `Are you sure you want to delete folder "${fileName}" and all its contents?` 
            : `Delete file "${fileName}"?`;

        if (window.confirm(confirmMsg)) {
            onDelete(fullPath);
        }
    };

    if (!isFolder) {
        return (
            <div 
                onClick={() => onSelect(fullPath)}
                className="file-node"
                style={{
                    padding: '5px 10px 5px 25px',
                    cursor: 'pointer',
                    background: activeFileName === fullPath ? '#37373d' : 'transparent',
                    color: activeFileName === fullPath ? '#fff' : '#9d9d9d',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', // Space between name and delete icon
                    fontSize: '14px',
                    borderLeft: activeFileName === fullPath ? '3px solid #4aed88' : '3px solid transparent'
                }}
            >
                <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
                    <span>{getFileIcon(fileName)}</span> 
                    {fileName} 
                </div>
                {/* Delete Icon (Hover pe dikhega better, par abhi simple rakhte hain) */}
                <span onClick={handleDeleteClick} style={{ cursor: 'pointer', fontSize:'12px', opacity: 0.7 }} title="Delete">🗑️</span>
            </div>
        );
    }

    return (
        <div>
            <div 
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    padding: '5px 10px',
                    cursor: 'pointer',
                    color: '#ccc',
                    fontWeight: 'bold',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    fontSize: '14px',
                }}
            >
                <div style={{display: 'flex', alignItems: 'center', gap: '5px'}}>
                    <span>{isOpen ? '📂' : '📁'}</span> 
                    {fileName}
                </div>
                <span onClick={handleDeleteClick} style={{ cursor: 'pointer', fontSize:'12px', opacity: 0.7 }} title="Delete Folder">🗑️</span>
            </div>
            
            {isOpen && (
                <div style={{ paddingLeft: '15px', borderLeft: '1px solid #333' }}>
                    {Object.keys(nodes).map((childName) => (
                        <FileTreeNode 
                            key={childName} 
                            fileName={childName}
                            nodes={nodes[childName]}
                            onSelect={onSelect} 
                            onDelete={onDelete} // Pass delete function down
                            activeFileName={activeFileName} 
                            path={fullPath} // Pass parent path
                        />
                    ))}
                </div>
            )}
        </div>
    );
};

const getFileIcon = (name) => {
    if (name.endsWith('.html')) return '🌐';
    if (name.endsWith('.css')) return '🎨';
    if (name.endsWith('.js')) return '📜';
    if (name.endsWith('.jsx')) return '⚛️';
    if (name.endsWith('.py')) return '🐍';
    if (name.endsWith('.java')) return '☕';
    return '📄';
};

const EditorPage = () => {
    const socketRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const navigate = useNavigate();
    
    const fileInputRef = useRef(null);
    const folderInputRef = useRef(null);

    const [files, setFiles] = useState({
        "src/App.js": {
            name: "src/App.js",
            language: "javascript",
            value: "// React App Code\nconsole.log('App Started');"
        },
        "style.css": {
            name: "style.css",
            language: "css",
            value: "body { background: #000; }"
        },
        "index.html": {
            name: "index.html",
            language: "html",
            value: ""
        }
    });

    const [activeFileName, setActiveFileName] = useState("src/App.js");
    const [output, setOutput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false);

    useEffect(() => {
        if (!location.state) {
            toast.error("Username is required");
            navigate('/');
        }
    }, [location.state, navigate]);

    useEffect(() => {
        const initSocket = async () => {
            socketRef.current = io('https://codesync-backend-sj9z.onrender.com', {
                transports: ['websocket', 'polling'],
                reconnectionAttempts: 5,
                reconnectionDelay: 1000,
                forceNew: true,
                timeout: 10000,
            });

            socketRef.current.on('connect_error', (err) => handleErrors(err));
            socketRef.current.on('connect_failed', (err) => handleErrors(err));

            function handleErrors(e) {
                console.log('socket error', e);
                toast.error('Socket connection failed, try again later.');
                navigate('/');
            }

            socketRef.current.emit('join', {
                roomId,
                username: location.state?.username,
            });

            socketRef.current.on('code_change', ({ fileName, code }) => {
                setFiles((prevFiles) => {
                    if (prevFiles[fileName]) {
                        return {
                            ...prevFiles,
                            [fileName]: { ...prevFiles[fileName], value: code }
                        };
                    }
                    return prevFiles;
                });
            });
            
            socketRef.current.on('file_created', ({ fileName, language, value }) => {
                setFiles((prev) => {
                    if (!prev[fileName]) {
                        return { ...prev, [fileName]: { name: fileName, language, value } };
                    }
                    return prev;
                });
                toast.success(`New file: ${fileName}`);
            });

            // === LISTEN FOR DELETE EVENTS ===
            socketRef.current.on('file_deleted', ({ id }) => {
                setFiles((prev) => {
                    const newFiles = { ...prev };
                    // Delete specific file OR all files in a folder
                    Object.keys(newFiles).forEach(key => {
                        if (key === id || key.startsWith(id + '/')) {
                            delete newFiles[key];
                        }
                    });
                    return newFiles;
                });
                toast.success(`Deleted: ${id}`);
            });

            socketRef.current.on('joined', ({ username }) => {
                if (username !== location.state.username) {
                    toast.success(`${username} joined the room.`);
                }
            });
        };

        initSocket();

        return () => {
            if (socketRef.current) socketRef.current.disconnect();
        };
    }, []);

    const buildFileTree = (files) => {
        const root = {};
        Object.keys(files).forEach((path) => {
            const parts = path.split('/');
            let current = root;
            parts.forEach((part, index) => {
                if (index === parts.length - 1) {
                    current[part] = null;
                } else {
                    if (!current[part]) current[part] = {};
                    current = current[part];
                }
            });
        });
        return root;
    };

    // Tree Render ab 'onDelete' aur 'path' ko pass karega
    const renderTree = (node, path = '') => {
        return Object.keys(node).map((key) => {
            return (
                <FileTreeNode 
                    key={key}
                    fileName={key}
                    nodes={node[key]}
                    path={path}
                    onSelect={setActiveFileName}
                    onDelete={handleDeleteNode}
                    activeFileName={activeFileName}
                />
            );
        });
    };

    const handleEditorChange = (value) => {
        setFiles((prev) => ({
            ...prev,
            [activeFileName]: { ...prev[activeFileName], value: value }
        }));
        if (socketRef.current) {
            socketRef.current.emit('code_change', { roomId, fileName: activeFileName, code: value });
        }
    };

    // === DELETE LOGIC ===
    const handleDeleteNode = (pathToDelete) => {
        // 1. Local State Update
        setFiles((prev) => {
            const newFiles = { ...prev };
            
            // Logic: Agar user ne 'src' delete kiya, toh 'src/App.js' bhi delete hona chahiye
            Object.keys(newFiles).forEach(key => {
                if (key === pathToDelete || key.startsWith(pathToDelete + '/')) {
                    delete newFiles[key];
                }
            });

            return newFiles;
        });

        // 2. Notify Server
        if (socketRef.current) {
            socketRef.current.emit('file_deleted', { roomId, id: pathToDelete });
        }
        
        // Agar active file delete ho gayi, toh active file reset kar do
        if (activeFileName === pathToDelete || activeFileName.startsWith(pathToDelete + '/')) {
            setActiveFileName("");
            setOutput("");
        }

        toast.success("Deleted successfully");
    };

    // ... Upload Logic ...
    const triggerFileUpload = () => fileInputRef.current.click();
    const triggerFolderUpload = () => folderInputRef.current.click();

    const processFile = (file) => {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const filePath = file.webkitRelativePath || file.name;
                let lang = "javascript";
                if (filePath.endsWith(".py")) lang = "python";
                if (filePath.endsWith(".java")) lang = "java";
                if (filePath.endsWith(".cpp")) lang = "cpp";
                if (filePath.endsWith(".html")) lang = "html";
                if (filePath.endsWith(".css")) lang = "css";
                resolve({ name: filePath, language: lang, value: ev.target.result });
            };
            reader.readAsText(file);
        });
    };

    const handleUpload = async (e) => {
        const uploadedFiles = e.target.files;
        if (!uploadedFiles) return;
        let newFiles = {};
        for (const file of uploadedFiles) {
            if(file.name === '.DS_Store') continue;
            const fileData = await processFile(file);
            newFiles[fileData.name] = fileData;
            if (socketRef.current) {
                socketRef.current.emit('file_created', {
                    roomId, fileName: fileData.name, language: fileData.language, value: fileData.value
                });
            }
        }
        setFiles((prev) => ({ ...prev, ...newFiles }));
        toast.success("Uploaded successfully!");
    };

    const createNewFile = () => {
        const fileName = prompt("Enter file path (e.g., src/components/Button.js):");
        if (!fileName) return;
        if (files[fileName]) {
            toast.error("File already exists!");
            return;
        }
        let lang = "javascript";
        if (fileName.endsWith(".py")) lang = "python";
        if (fileName.endsWith(".java")) lang = "java";
        if (fileName.endsWith(".cpp")) lang = "cpp";
        if (fileName.endsWith(".css")) lang = "css";
        if (fileName.endsWith(".html")) lang = "html";
        const newFile = { name: fileName, language: lang, value: `// ${fileName}` };
        setFiles((prev) => ({ ...prev, [fileName]: newFile }));
        setActiveFileName(fileName);
        if (socketRef.current) {
            socketRef.current.emit('file_created', { roomId, fileName, language: lang, value: newFile.value });
        }
        toast.success("File created!");
    };

    const runCode = async () => {
        setIsLoading(true);
        setIsError(false);
        const currentFile = files[activeFileName];
        if(!currentFile) {
            toast.error("No file selected!");
            setIsLoading(false);
            return;
        }
        const filesArray = Object.values(files); 
        try {
            const response = await axios.post('https://codesync-backend-sj9z.onrender.com/execute', {
                files: filesArray, mainFile: currentFile, language: currentFile.language
            });
            const result = response.data.run;
            if (result.signal) {
                setOutput(`Error: ${result.signal}`);
                setIsError(true);
            } else {
                setOutput(result.output || result.stderr || "No Output");
                if (result.stderr) setIsError(true);
            }
        } catch (error) {
            console.error(error);
            setOutput("Error: Failed to execute code.");
            setIsError(true);
        } finally {
            setIsLoading(false);
        }
    };

    const downloadZip = async () => {
        const zip = new JSZip();
        Object.values(files).forEach((file) => {
            zip.file(file.name, file.value);
        });
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "CodeSync_Project.zip");
        toast.success("Project downloaded!");
    };

    if (!location.state) return null;
    const file = files[activeFileName];
    const fileTree = buildFileTree(files);

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden' }}>
            
            {/* Header */}
            <div style={{ height: '50px', background: '#333333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 15px', borderBottom: '1px solid #252526' }}>
                <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                    <div style={{ background:'#4aed88', width:'20px', height:'20px', borderRadius:'4px'}}></div>
                    <span style={{ fontWeight: '600', color: '#ccc', letterSpacing:'1px' }}>CodeSync Pro</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={downloadZip} style={{ background: '#333', color: '#fff', border: '1px solid #555', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontSize:'12px', display:'flex', alignItems:'center', gap:'5px' }}>
                        📥 Zip
                    </button>
                    <button onClick={runCode} disabled={isLoading} style={{ padding: '6px 15px', background: isLoading ? '#555' : '#0e639c', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight:'bold', display:'flex', alignItems:'center', gap:'5px' }}>
                        {isLoading ? "Running..." : "▶ Run"}
                    </button>
                    <button onClick={() => { navigator.clipboard.writeText(roomId); toast.success('Room ID copied'); }} style={{ background: '#444', color: '#fff', border: 'none', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer' }}>Copy ID</button>
                </div>
            </div>

            {/* Main Workspace */}
            <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                
                {/* Sidebar */}
                <div style={{ width: '220px', background: '#252526', borderRight: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ padding: '10px 15px', color:'#bbb', fontSize:'11px', fontWeight:'bold', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span>EXPLORER</span>
                        <div style={{display:'flex', gap:'5px'}}>
                             <button onClick={triggerFolderUpload} style={{ background:'none', border:'none', color:'#ccc', cursor:'pointer', fontSize:'16px' }} title="Open Folder">📂</button>
                             <button onClick={triggerFileUpload} style={{ background:'none', border:'none', color:'#ccc', cursor:'pointer', fontSize:'16px' }} title="Upload File">📄</button>
                            <button onClick={createNewFile} style={{ background:'none', border:'none', color:'#ccc', cursor:'pointer', fontSize:'18px' }} title="New File / Folder">+</button>
                        </div>
                    </div>
                    
                    {/* Inputs */}
                    <input type="file" multiple ref={fileInputRef} style={{ display: 'none' }} onChange={handleUpload} />
                    <input type="file" ref={folderInputRef} webkitdirectory="" directory="" style={{ display: 'none' }} onChange={handleUpload} />

                    {/* Tree View */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '5px' }}>
                        {renderTree(fileTree)}
                    </div>
                </div>

                {/* Editor & Output */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
                    <div style={{ height: '35px', background: '#1e1e1e', display: 'flex', borderBottom: '1px solid #333' }}>
                        <div style={{ padding: '0 15px', background: '#1e1e1e', color: '#fff', display: 'flex', alignItems: 'center', borderTop: '2px solid #4aed88', fontSize: '13px', gap: '8px' }}>
                             {activeFileName ? (
                                <>
                                    {getFileIcon(activeFileName)} {activeFileName.split('/').pop()}
                                </>
                             ) : "No File Selected"}
                        </div>
                    </div>

                    <div style={{ flex: 1, position: 'relative' }}>
                        {activeFileName ? (
                            <Editor
                                height="100%" width="100%" theme="vs-dark"
                                path={file?.name || "script.js"} 
                                defaultLanguage={file?.language || "javascript"} 
                                defaultValue={file?.value || ""}
                                value={file?.value || ""} 
                                onChange={handleEditorChange}
                                options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }}
                            />
                        ) : (
                            <div style={{height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color:'#555'}}>Select a file to edit</div>
                        )}
                    </div>

                    <div style={{ height: '200px', background: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '5px 15px', fontSize:'11px', color:'#aaa', borderBottom:'1px solid #2d2d2d', fontWeight:'bold', display:'flex', justifyContent:'space-between' }}>
                            <span>OUTPUT</span>
                            {output && <span onClick={() => setOutput("")} style={{cursor:'pointer', color:'#fff'}}>🗑️ Clear</span>}
                        </div>
                        <pre style={{ 
                            flex: 1, padding: '10px 15px', margin: 0,
                            fontFamily: "'Fira Code', monospace", fontSize: '14px',
                            color: isError ? '#f87171' : '#a7f3d0', 
                            whiteSpace: 'pre-wrap', overflowY: 'auto'
                        }}>
                            {output || <span style={{color:'#555', fontStyle:'italic'}}>Run code to see output here...</span>}
                        </pre>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default EditorPage;