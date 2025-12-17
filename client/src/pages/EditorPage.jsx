import React, { useEffect, useState, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { io } from 'socket.io-client';
import axios from 'axios';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';

const EditorPage = () => {
    const socketRef = useRef(null);
    const location = useLocation();
    const { roomId } = useParams();
    const navigate = useNavigate();

    // Default files structure
    const [files, setFiles] = useState({
        "script.js": {
            name: "script.js",
            language: "javascript",
            value: "// Write your JS code here\nconsole.log('Hello World');"
        },
        "style.css": {
            name: "style.css",
            language: "css",
            value: "/* Write your CSS code here */\nbody { background: #000; }"
        },
        "index.html": {
            name: "index.html",
            language: "html",
            value: "\n<div></div>"
        }
    });

    const [activeFileName, setActiveFileName] = useState("script.js");
    const [output, setOutput] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isError, setIsError] = useState(false); // Error ko red color dene ke liye

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
                toast.success(`New file created: ${fileName}`);
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

    const handleEditorChange = (value) => {
        setFiles((prev) => ({
            ...prev,
            [activeFileName]: { ...prev[activeFileName], value: value }
        }));

        if (socketRef.current) {
            socketRef.current.emit('code_change', {
                roomId,
                fileName: activeFileName,
                code: value,
            });
        }
    };

    const createNewFile = () => {
        const fileName = prompt("Enter file name (e.g., app.py):");
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

        const newFile = { name: fileName, language: lang, value: `// New file: ${fileName}` };
        
        setFiles((prev) => ({ ...prev, [fileName]: newFile }));
        setActiveFileName(fileName);

        if (socketRef.current) {
            socketRef.current.emit('file_created', {
                roomId, fileName, language: lang, value: newFile.value
            });
        }
        toast.success("File created!");
    };

    const runCode = async () => {
        setIsLoading(true);
        setIsError(false);
        const currentFile = files[activeFileName];
        const filesArray = Object.values(files); 

        try {
            const response = await axios.post('https://codesync-backend-sj9z.onrender.com/execute', {
                files: filesArray,
                mainFile: currentFile,
                language: currentFile.language
            });

            const result = response.data.run;
            
            if (result.signal) {
                setOutput(`Error: ${result.signal}`);
                setIsError(true);
            } else {
                // Stdout + Stderr (Compilation errors also show here usually)
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

    if (!location.state) return null;
    const file = files[activeFileName];

    const getFileIcon = (name) => {
        if (name.endsWith('.html')) return '🌐';
        if (name.endsWith('.css')) return '🎨';
        if (name.endsWith('.js')) return '📜';
        if (name.endsWith('.py')) return '🐍';
        if (name.endsWith('.java')) return '☕';
        if (name.endsWith('.cpp')) return '⚙️';
        return '📄';
    };

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#1e1e1e', overflow: 'hidden' }}>
            
            {/* Header */}
            <div style={{ height: '50px', background: '#333333', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 15px', borderBottom: '1px solid #252526' }}>
                <div style={{display:'flex', alignItems:'center', gap:'10px'}}>
                    <div style={{ background:'#4aed88', width:'20px', height:'20px', borderRadius:'4px'}}></div>
                    <span style={{ fontWeight: '600', color: '#ccc', letterSpacing:'1px' }}>CodeSync Pro</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <span style={{ color: '#888', fontSize:'12px', display:'flex', alignItems:'center', marginRight:'10px' }}>Room: {roomId}</span>
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
                        <button onClick={createNewFile} style={{ background:'none', border:'none', color:'#ccc', cursor:'pointer', fontSize:'16px' }} title="New File">+</button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto' }}>
                        {Object.keys(files).map((fileName) => (
                            <div key={fileName} onClick={() => setActiveFileName(fileName)} style={{
                                padding: '6px 15px', cursor: 'pointer',
                                background: activeFileName === fileName ? '#37373d' : 'transparent',
                                color: activeFileName === fileName ? '#fff' : '#9d9d9d',
                                display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px',
                                borderLeft: activeFileName === fileName ? '3px solid #4aed88' : '3px solid transparent'
                            }}>
                                <span>{getFileIcon(fileName)}</span> {fileName}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Editor Area */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
                    
                    {/* Active File Tab */}
                    <div style={{ height: '35px', background: '#1e1e1e', display: 'flex', borderBottom: '1px solid #333' }}>
                        <div style={{ padding: '0 15px', background: '#1e1e1e', color: '#fff', display: 'flex', alignItems: 'center', borderTop: '2px solid #4aed88', fontSize: '13px', gap: '8px' }}>
                             {getFileIcon(activeFileName)} {activeFileName}
                        </div>
                    </div>

                    {/* Monaco Editor */}
                    <div style={{ flex: 1, position: 'relative' }}>
                        <Editor
                            height="100%" width="100%" theme="vs-dark"
                            path={file.name} defaultLanguage={file.language} defaultValue={file.value}
                            value={file.value} onChange={handleEditorChange}
                            options={{ minimap: { enabled: false }, fontSize: 14, automaticLayout: true }}
                        />
                    </div>

                    {/* SIMPLE OUTPUT WINDOW (Replacement for Terminal) */}
                    <div style={{ height: '200px', background: '#1e1e1e', borderTop: '1px solid #333', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '5px 15px', fontSize:'11px', color:'#aaa', borderBottom:'1px solid #2d2d2d', fontWeight:'bold', display:'flex', justifyContent:'space-between' }}>
                            <span>OUTPUT</span>
                            {output && <span onClick={() => setOutput("")} style={{cursor:'pointer', color:'#fff'}}>🗑️ Clear</span>}
                        </div>
                        
                        <pre style={{ 
                            flex: 1, 
                            padding: '10px 15px', 
                            margin: 0,
                            fontFamily: "'Fira Code', monospace", 
                            fontSize: '14px',
                            color: isError ? '#f87171' : '#a7f3d0', // Red for error, Greenish for success
                            whiteSpace: 'pre-wrap', // Wraps text properly
                            overflowY: 'auto'
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