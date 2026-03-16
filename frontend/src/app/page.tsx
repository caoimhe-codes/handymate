/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
"use client";
import { useEffect, useRef, useState } from "react";
import { useLiveAPI } from "@/hooks/useLiveAPI";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc } from "firebase/firestore";
import Image from "next/image";

interface Project {
    id: string;
    title?: string;
    summary?: string;
    status?: string;
    estimatedTime?: string;
    toolsNeeded?: string[];
    steps?: string[];
    createdAt?: unknown;
}

export default function Home() {
    const router = useRouter();
    const [experience, setExperience] = useState<string>("Unknown");
    const [inventory, setInventory] = useState<string[]>([]);
    const [userId, setUserId] = useState<string | null>(null);
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    
    // Summary & Projects State
    const [projects, setProjects] = useState<Project[]>([]);
    const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryInput, setSummaryInput] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);

    // Dynamic Tool Addition
    const [newTool, setNewTool] = useState("");
    const [isScanningInline, setIsScanningInline] = useState(false);

    // Active Reopen Project State
    const [activeProject, setActiveProject] = useState<Project | null>(null);

    // Pass the context to the hook so it can send it to the backend
    const { connected, connect, disconnect, stream, transcriptRef, isPaused, togglePause, isConnecting } = useLiveAPI(
        experience, 
        inventory, 
        activeProject ? { summary: activeProject.summary, steps: activeProject.steps } : null
    );
    const videoRef = useRef<HTMLVideoElement>(null);

    // Dashboard Live Scanner State
    const scanVideoRef = useRef<HTMLVideoElement>(null);
    const scanCanvasRef = useRef<HTMLCanvasElement>(null);
    const [isScanningTools, setIsScanningTools] = useState(false);
    const [scanStream, setScanStream] = useState<MediaStream | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const exp = localStorage.getItem("handymate_experience");
            const inv = localStorage.getItem("handymate_inventory");
            if (!exp || !inv) {
                // Force onboarding if they haven't done it
                router.push("/onboarding");
                return;
            }
            
            setExperience(exp);
            
            setInventory(JSON.parse(inv));
            
            setUserId(localStorage.getItem("handymate_user_id"));
        }
    }, [router]);

    // Listen to Firebase Projects
    useEffect(() => {
        if (!userId) return;
        const q = query(collection(db, "users", userId, "projects"), orderBy("createdAt", "desc"));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }) as Project);
            // Filter out or handle completely empty projects that failed generation
            setProjects(data);
        });
        return () => unsubscribe();
    }, [userId]);

    const deleteProject = async (projectId: string) => {
        if (!userId) return;
        try {
            const { doc, deleteDoc } = await import("firebase/firestore");
            await deleteDoc(doc(db, "users", userId, "projects", projectId));
        } catch (e) {
            console.error("Failed to delete project", e);
        }
    };

    const handleAddTool = async (toolsToAdd: string[]) => {
        if (!userId || toolsToAdd.length === 0) return;
        try {
            const updatedInventory = [...new Set([...inventory, ...toolsToAdd])];
            await updateDoc(doc(db, "users", userId), { inventory: updatedInventory });
            localStorage.setItem("handymate_inventory", JSON.stringify(updatedInventory));
            setInventory(updatedInventory);
            setNewTool("");
        } catch (error) {
            console.error("Error adding tool: ", error);
            alert("Failed to update inventory.");
        }
    };

    const handleInlineImageScan = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !userId) return;

        setIsScanningInline(true);
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new window.Image();
            img.onload = async () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 800;
                let width = img.width;
                let height = img.height;

                if (width > MAX_WIDTH) {
                    height = Math.round((height * MAX_WIDTH) / width);
                    width = MAX_WIDTH;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext("2d");
                ctx?.drawImage(img, 0, 0, width, height);

                const base64Data = canvas.toDataURL("image/jpeg", 0.7).split(',')[1];
                
                try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
                    const res = await fetch(`${apiUrl}/api/detect-tools`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ imageBase64: base64Data })
                    });
            
                    if (!res.ok) throw new Error("API failed");
                    const detectedTools: string[] = await res.json();
                    if (Array.isArray(detectedTools) && detectedTools.length > 0) {
                        await handleAddTool(detectedTools);
                    } else {
                        alert("No tools detected in the image.");
                    }
                } catch (err) {
                    console.error("Failed to analyze inline image", err);
                    alert("Failed to analyze image. Please try again or add tools manually.");
                } finally {
                    setIsScanningInline(false);
                }
            };
            img.src = event.target?.result as string;
        };
        reader.readAsDataURL(file);
        e.target.value = ""; // reset input
    };

    const startScannerCamera = async () => {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
            setScanStream(newStream);
            if (scanVideoRef.current) {
                scanVideoRef.current.srcObject = newStream;
            }
            setIsScanningTools(true);
        } catch (err) {
            console.error("Failed to access camera", err);
            alert("Could not access your camera. Please ensure permissions are granted or use the manual search or photo upload.");
        }
    };

    const stopScannerCamera = () => {
        if (scanStream) {
            scanStream.getTracks().forEach(track => track.stop());
            setScanStream(null);
        }
        setIsScanningTools(false);
    };

    const captureScannerFrame = async () => {
        if (!scanVideoRef.current || !scanCanvasRef.current || !userId) return;
        
        setIsScanningInline(true); // Reuse the loading state
        
        const video = scanVideoRef.current;
        const canvas = scanCanvasRef.current;
        const ctx = canvas.getContext("2d");
        
        const MAX_WIDTH = 800;
        let width = video.videoWidth;
        let height = video.videoHeight;
        
        if (width > MAX_WIDTH) {
            height = Math.round((height * MAX_WIDTH) / width);
            width = MAX_WIDTH;
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(video, 0, 0, width, height);
        
        const base64Data = canvas.toDataURL("image/jpeg", 0.7).split(',')[1];
        stopScannerCamera();
        
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
            const res = await fetch(`${apiUrl}/api/detect-tools`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ imageBase64: base64Data })
            });

            if (!res.ok) throw new Error("API failed");
            const detectedTools: string[] = await res.json();
            if (Array.isArray(detectedTools) && detectedTools.length > 0) {
                await handleAddTool(detectedTools);
            } else {
                alert("No tools detected in the image.");
            }
        } catch (err) {
            console.error("Failed to analyze camera image", err);
            alert("Failed to analyze image. Please try again or add tools manually.");
        } finally {
            setIsScanningInline(false);
        }
    };

    const handleEndCall = () => {
        disconnect();
        // Do not clear activeProject here yet so it can be passed to the summary generation!
        const currentTranscript = transcriptRef.current;
        if (currentTranscript && currentTranscript.trim().length > 10) {
            handleGenerateSummary(currentTranscript);
        } else {
            setShowSummaryModal(true);
        }
    };

    const handleGenerateSummary = async (autoTranscript?: unknown) => {
        const textToSummarize = typeof autoTranscript === "string" ? autoTranscript : summaryInput;
        if (!textToSummarize.trim() || !userId) return;
        
        setIsGenerating(true);
        if (typeof autoTranscript === "string") {
            setShowSummaryModal(true);
        }
        
        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
            const res = await fetch(`${apiUrl}/api/summarize`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    transcript: textToSummarize,
                    experience,
                    inventory: inventory.join(", "),
                    activeProjectId: activeProject?.id,
                    previousSummary: activeProject?.summary,
                    previousSteps: activeProject?.steps
                })
            });
            const summaryJson = await res.json();
            
            // Save to Firestore: update existing if resuming, else create new
            if (activeProject && activeProject.id) {
                await updateDoc(doc(db, "users", userId, "projects", activeProject.id), {
                    ...summaryJson,
                    updatedAt: new Date() // track when it was amended
                });
            } else {
                await addDoc(collection(db, "users", userId, "projects"), {
                    ...summaryJson,
                    createdAt: new Date()
                });
            }

            setShowSummaryModal(false);
            setSummaryInput("");
            setActiveProject(null); // safely wipe active state now
        } catch (e) {
            console.error(e);
            alert("Failed to generate summary.");
        } finally {
            setIsGenerating(false);
        }
    };

    useEffect(() => {
        if (videoRef.current && stream) {
            videoRef.current.srcObject = stream;
        }
    }, [stream]);

    return (
        <div className="min-h-screen bg-teal-950 text-teal-50 flex overflow-hidden font-sans">
            {/* Mobile Overlay */}
            {isMobileMenuOpen && (
                <div 
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden transition-opacity" 
                    onClick={() => setIsMobileMenuOpen(false)}
                />
            )}
            
            {/* Sidebar Context Panel */}
            <aside className={`w-80 bg-teal-950/95 md:bg-teal-900/40 backdrop-blur-3xl border-r border-teal-800/50 flex flex-col fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 md:flex shadow-2xl`}>
                {/* Subtle glass reflection */}
                <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
                
                <div className="p-8 border-b border-teal-800/50 flex flex-col items-center gap-4 relative">
                    <button 
                        className="absolute top-4 right-4 md:hidden text-teal-400/50 hover:text-white p-2"
                        onClick={() => setIsMobileMenuOpen(false)}
                    >
                        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <Image src="/logo.png" alt="HandyMate Logo" width={80} height={80} className="drop-shadow-lg rounded-2xl" />
                    <h1 className="text-2xl font-extrabold tracking-tight">
                        <span className="text-white">Handy</span><span className="text-teal-400">Mate</span>
                    </h1>
                </div>
                <div className="p-6 flex-1 overflow-y-auto relative z-10">
                    <div className="mb-8">
                        <h2 className="text-[10px] uppercase tracking-widest text-teal-400/70 font-bold mb-3">AI Context Profile</h2>
                        <div className="bg-teal-950/50 rounded-xl p-4 border border-teal-800/50 shadow-inner">
                            <div className="text-xs text-teal-300/70 mb-1">Assumed Skill Level:</div>
                            <div className="font-semibold text-white flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-teal-400 inline-block shadow-[0_0_10px_rgba(45,212,191,0.6)]"></span>
                                {experience}
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <div className="flex justify-between items-center mb-3">
                            <h2 className="text-[10px] uppercase tracking-widest text-teal-400/70 font-bold">Available Tools</h2>
                        </div>
                        {inventory.length === 0 ? (
                            <p className="text-sm text-teal-500/60 italic mb-4">No tools added.</p>
                        ) : (
                            <ul className="space-y-2 mb-4">
                                {inventory.map((tool) => (
                                    <li key={tool} className="flex items-center gap-3 text-sm bg-teal-800/30 px-3 py-2 rounded-xl border border-teal-700/30 text-teal-100 shadow-sm transition-all hover:bg-teal-800/50">
                                        <svg className="w-3 h-3 text-teal-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span className="font-medium truncate">{tool}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                        
                        <div className="flex flex-col gap-2">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newTool}
                                    onChange={(e) => setNewTool(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && newTool.trim() && handleAddTool([newTool.trim()])}
                                    placeholder="Add tool manually..."
                                    className="flex-1 bg-teal-950/50 border border-teal-700/50 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-teal-400 placeholder:text-teal-700/80 min-w-0"
                                />
                                <button
                                    onClick={() => newTool.trim() && handleAddTool([newTool.trim()])}
                                    disabled={!newTool.trim()}
                                    className="bg-teal-700/50 hover:bg-teal-600 text-teal-100 rounded-lg px-4 py-2 text-xs font-bold transition-colors disabled:opacity-50 shrink-0"
                                >
                                    Add
                                </button>
                            </div>
                            
                            {isScanningInline ? (
                                <div className="flex items-center justify-center bg-teal-500/20 border border-teal-500/30 text-teal-300 rounded-lg py-2.5 text-xs font-bold transition-colors">
                                    <span className="w-4 h-4 border-2 border-teal-700 border-t-teal-400 rounded-full animate-spin"></span>
                                </div>
                            ) : (
                                <div className="flex gap-2">
                                    <label className="flex-1 flex items-center justify-center bg-teal-500/20 hover:bg-teal-500/40 border border-teal-500/30 text-teal-300 rounded-lg py-2 cursor-pointer transition-colors" title="Upload Photo">
                                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handleInlineImageScan} />
                                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                        </svg>
                                        <span className="text-[11px] font-bold tracking-wide uppercase truncate">Upload</span>
                                    </label>
                                    <button 
                                        onClick={startScannerCamera}
                                        className="flex-1 flex items-center justify-center bg-teal-500/20 hover:bg-teal-500/40 border border-teal-500/30 text-teal-300 rounded-lg py-2 transition-colors" title="Take Photo">
                                        <svg className="w-4 h-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                        </svg>
                                        <span className="text-[11px] font-bold tracking-wide uppercase truncate">Camera</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="p-4 border-t border-teal-800/50 bg-teal-950/60 text-center relative z-10">
                    <p className="text-[9px] text-teal-600/80 font-bold uppercase tracking-widest leading-relaxed">
                        © 2026 Lonrú Consulting Ltd. <br/> Active Architecture™ Powered by Lonrú Studios™
                    </p>
                </div>
            </aside>

            {/* Main Stage */}
            <main className="flex-1 flex flex-col relative z-10 bg-black/20">
                {/* Decorative background glow */}
                <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000 ${connected ? 'bg-teal-500/20' : 'bg-teal-800/10'}`} />

                {/* Mobile Header (Shows when Sidebar is hidden) */}
                <div className="md:hidden p-4 border-b border-teal-800/50 bg-teal-900/40 backdrop-blur-xl flex items-center justify-between z-30">
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={() => setIsMobileMenuOpen(true)}
                            className="text-teal-400 p-1 mr-2 hover:bg-teal-800/50 rounded-lg transition-colors"
                        >
                            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" /></svg>
                        </button>
                        <Image src="/logo.png" alt="HandyMate Logo" width={32} height={32} className="rounded-xl shadow-md" />
                        <h1 className="text-xl font-extrabold tracking-tight">
                            <span className="text-white">Handy</span><span className="text-teal-400">Mate</span>
                        </h1>
                    </div>
                </div>

                <div className="flex-1 p-6 flex flex-col items-center justify-center pt-8 md:pt-6">
                    {/* Status Top Bar */}
                    <div className="absolute top-24 md:top-6 left-0 w-full flex justify-center pointer-events-none z-30">
                        <div className={`px-5 py-2 rounded-full text-[11px] font-bold tracking-widest uppercase shadow-2xl flex items-center gap-2 backdrop-blur-xl transition-all duration-500 ${connected ? (isPaused ? 'bg-amber-500/20 text-amber-300 border border-amber-400/40' : 'bg-teal-500/20 text-teal-300 border border-teal-400/40') : 'bg-teal-900/60 text-teal-400/60 border border-teal-800/60'}`}>
                            {connected ? (
                                isPaused ? (
                                    <><span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]"></span> Paused</>
                                ) : (
                                    <><span className="w-2.5 h-2.5 rounded-full bg-teal-400 animate-pulse shadow-[0_0_8px_rgba(45,212,191,0.8)]"></span> Agent Active</>
                                )
                            ) : (
                                <><span className="w-2.5 h-2.5 rounded-full bg-teal-700"></span> Standing By</>
                            )}
                        </div>
                    </div>

                    {/* Camera Feed */}
                    <div className="relative w-full max-w-4xl aspect-[4/3] sm:aspect-video bg-teal-950/80 rounded-3xl overflow-hidden shadow-2xl ring-1 ring-white/10 z-10 backdrop-blur-md">
                        {!connected && !stream && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center text-teal-600/50 bg-teal-950/90 mix-blend-multiply">
                                <svg className="w-16 h-16 mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                </svg>
                                <span className="font-medium text-lg tracking-wide uppercase text-xs">Camera Offline</span>
                            </div>
                        )}
                        <video 
                            ref={videoRef}
                            autoPlay 
                            playsInline
                            muted
                            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${!stream ? 'opacity-0' : 'opacity-100'}`}
                        />
                    </div>
                </div>

                {/* Control Bar */}
                <div className="h-32 bg-teal-950/80 backdrop-blur-2xl border-t border-teal-800/40 flex items-center justify-center px-6 relative z-20">
                    <div className="absolute inset-0 bg-gradient-to-t from-teal-900/20 to-transparent pointer-events-none" />
                    <div className="flex gap-6 items-center relative z-10">
                        {!connected ? (
                            <button 
                                onClick={() => connect()}
                                disabled={isConnecting}
                                className="group relative px-10 py-5 bg-teal-500 hover:bg-teal-400 text-teal-950 rounded-2xl font-black text-lg shadow-[0_0_40px_-5px_rgba(20,184,166,0.5)] transition-all hover:shadow-[0_0_60px_-5px_rgba(20,184,166,0.7)] hover:-translate-y-1 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:hover:shadow-[0_0_40px_-5px_rgba(20,184,166,0.5)]"
                            >
                                <span className="flex items-center gap-3">
                                    {isConnecting ? (
                                        <>
                                            <span className="w-6 h-6 border-4 border-teal-950/20 border-t-teal-950 rounded-full animate-spin"></span>
                                            Connecting...
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
                                            </svg>
                                            Call HandyMate
                                        </>
                                    )}
                                </span>
                            </button>
                        ) : (
                            <>
                                <button 
                                    onClick={togglePause}
                                    className={`px-8 py-5 border ${isPaused ? 'bg-amber-500/20 border-amber-500/40 text-amber-400' : 'bg-teal-800/30 border-teal-600/30 hover:bg-teal-800/50 text-teal-300'} rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 active:translate-y-0 flex items-center gap-3`}
                                >
                                    {isPaused ? (
                                        <>
                                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M8 5v14l11-7z" />
                                            </svg>
                                            Resume Call
                                        </>
                                    ) : (
                                        <>
                                            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" />
                                            </svg>
                                            Pause Call
                                        </>
                                    )}
                                </button>
                                <button 
                                    onClick={handleEndCall}
                                    className="px-8 py-5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-2xl font-bold text-lg transition-all hover:-translate-y-1 active:translate-y-0 flex items-center gap-3"
                                >
                                    <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3.53 12.47l-1.06 1.06L12 13.06l-2.47 2.47-1.06-1.06L10.94 12 8.47 9.53l1.06-1.06L12 10.94l2.47-2.47 1.06 1.06L13.06 12l2.47 2.47z"/>
                                    </svg>
                                    End Session
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* Past Projects Section */}
                {projects.length > 0 && (
                    <div className="bg-teal-950/80 backdrop-blur-xl border-t border-teal-800/50 p-6 z-20 pb-24 relative">
                        <div className="max-w-4xl mx-auto">
                            <h2 className="text-xl font-bold text-white mb-6 flex items-center gap-3">
                                <svg className="w-5 h-5 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                                </svg>
                                Past Projects
                            </h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {projects.map(proj => {
                                    const isExpanded = expandedProjectId === proj.id;
                                    const hasValidContent = proj.title && proj.steps;
                                    
                                    return (
                                        <div 
                                            key={proj.id} 
                                            onClick={() => hasValidContent && setExpandedProjectId(isExpanded ? null : proj.id)}
                                            className={`bg-teal-900/40 border ${isExpanded ? 'border-teal-400 shadow-[0_0_20px_rgba(45,212,191,0.15)]' : 'border-teal-700/50 shadow-lg'} rounded-3xl p-6 backdrop-blur-md hover:border-teal-400/50 transition-all duration-300 ${hasValidContent ? 'cursor-pointer hover:bg-teal-900/60' : ''} group relative`}
                                        >
                                            <div className="flex justify-between items-start mb-3">
                                                <h3 className="font-bold text-lg text-white group-hover:text-teal-300 transition-colors">
                                                    {proj.title || "Failed Summary"}
                                                </h3>
                                                <button 
                                                    onClick={(e) => { e.stopPropagation(); deleteProject(proj.id); }}
                                                    className="text-teal-500/50 hover:text-red-400 transition-colors p-1"
                                                    title="Delete this record"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                    </svg>
                                                </button>
                                            </div>
                                            
                                            <p className="text-sm text-teal-200/60 mb-5 leading-relaxed">{proj.summary || "The AI encountered an error formatting this task. Please delete."}</p>
                                            
                                            {hasValidContent && (
                                                <div className="grid grid-cols-2 gap-4 mb-5">
                                                    {proj.status && (
                                                        <div className="bg-teal-950/40 rounded-xl p-3 border border-teal-800/40">
                                                            <div className="text-[10px] font-bold text-teal-500/70 uppercase tracking-widest mb-1.5">Status</div>
                                                            <div className={`text-xs font-bold ${proj.status.includes('Completed') ? 'text-teal-400' : 'text-amber-400'}`}>
                                                                {proj.status}
                                                            </div>
                                                        </div>
                                                    )}
                                                    {proj.estimatedTime && (
                                                        <div className="bg-teal-950/40 rounded-xl p-3 border border-teal-800/40">
                                                            <div className="text-[10px] font-bold text-teal-500/70 uppercase tracking-widest mb-1.5">Est. Time</div>
                                                            <div className="text-xs font-medium text-teal-100">
                                                                {proj.estimatedTime}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {hasValidContent && proj.toolsNeeded && proj.toolsNeeded.length > 0 && (
                                                <div className="mb-5">
                                                    <div className="text-[10px] font-bold text-teal-500/70 uppercase tracking-widest mb-2.5">Tools Needed for Job</div>
                                                    <div className="flex flex-wrap gap-2">
                                                        {proj.toolsNeeded.map((tool: string, i: number) => (
                                                            <span key={i} className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg text-xs font-medium shadow-sm">
                                                                {tool}
                                                            </span>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {hasValidContent && (
                                                <div className={`overflow-hidden transition-all duration-500 ease-in-out ${isExpanded ? 'max-h-[1200px] opacity-100 mt-5' : 'max-h-0 opacity-0'}`}>
                                                    <div className="bg-teal-950/50 rounded-2xl p-5 border border-teal-800/50 shadow-inner">
                                                        <div className="space-y-3">
                                                        {proj.steps?.map((step: string, index: number) => (
                                                                <li key={index} className="text-sm text-teal-50 flex gap-4 leading-relaxed">
                                                                    <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-800/50 text-teal-400 flex items-center justify-center font-bold text-xs">{index+1}</span>
                                                                    <span className="pt-0.5">{step}</span>
                                                                </li>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                            
                                            {hasValidContent && !isExpanded && (
                                                <div className="text-xs text-teal-400 font-medium flex items-center gap-1.5 mt-2 opacity-80 group-hover:opacity-100 transition-opacity">
                                                    Click to expand details
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                                    </svg>
                                                </div>
                                            )}

                                            {hasValidContent && isExpanded && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setActiveProject(proj);
                                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                                        connect({ summary: proj.summary, steps: proj.steps });
                                                    }}
                                                    className="w-full mt-5 py-3 bg-teal-500/20 hover:bg-teal-500/40 border border-teal-500/50 text-teal-300 rounded-xl font-bold transition-colors flex items-center justify-center gap-2 shadow-sm"
                                                >
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                                    </svg>
                                                    Resume Repair Call
                                                </button>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
                
                {/* Bottom decorative space */}
                <div className="h-8 md:hidden"></div>
            </main>

            {/* Summary Modal */}
            {showSummaryModal && (
                <div className="fixed inset-0 bg-teal-950/90 backdrop-blur-xl z-50 flex items-center justify-center p-4">
                    <div className="bg-teal-900 border border-teal-700/50 rounded-[2rem] p-10 max-w-lg w-full shadow-2xl animate-in fade-in zoom-in duration-300 relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-teal-400 via-teal-300 to-teal-500"></div>
                        <h2 className="text-2xl font-extrabold text-white mb-3">Call complete!</h2>
                        
                        {isGenerating && transcriptRef.current?.trim().length > 10 ? (
                            <div className="py-12 flex flex-col items-center justify-center">
                                <span className="animate-pulse text-xl font-bold text-teal-300 mb-4 tracking-wide">Analyzing AI Transcript...</span>
                                <p className="text-teal-200/70 text-sm text-center max-w-xs">HandyMate is formatting a step-by-step diagnostic summary for your records.</p>
                            </div>
                        ) : (
                            <>
                                <p className="text-teal-200/80 mb-8 leading-relaxed">What task did you just finish working on with HandyMate? We&apos;ll generate a step-by-step summary for your records.</p>
                                
                                <input 
                                    type="text" 
                                    className="w-full bg-teal-950/50 border border-teal-700/50 rounded-2xl px-5 py-4 text-white focus:outline-none focus:ring-2 focus:ring-teal-400 focus:border-transparent mb-8 transition-all shadow-inner placeholder:text-teal-700 font-medium"
                                    placeholder="e.g. Fixing a leaky kitchen sink pipe..."
                                    value={summaryInput}
                                    onChange={(e) => setSummaryInput(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') handleGenerateSummary() }}
                                    autoFocus
                                />
                                
                                <div className="flex gap-4">
                                    <button 
                                        onClick={() => setShowSummaryModal(false)}
                                        className="flex-1 py-4 bg-teal-800/40 hover:bg-teal-800/70 text-teal-100 rounded-2xl font-bold transition-colors"
                                    >
                                        Skip
                                    </button>
                                    <button 
                                        onClick={handleGenerateSummary}
                                        disabled={isGenerating || !summaryInput.trim()}
                                        className="flex-1 py-4 bg-teal-500 hover:bg-teal-400 disabled:opacity-50 disabled:hover:bg-teal-500 text-teal-950 rounded-2xl font-black transition-all flex items-center justify-center shadow-[0_0_20px_rgba(20,184,166,0.2)]"
                                    >
                                        {isGenerating ? <span className="animate-pulse">Generating...</span> : "Save Summary"}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
            {/* Tool Scanner Modal */}
            {isScanningTools && (
                <div className="fixed inset-0 bg-black/90 z-[100] flex flex-col items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-teal-950/80 p-6 rounded-[2rem] border border-teal-800/50 shadow-2xl relative">
                        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-3">
                            <svg className="w-6 h-6 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                            </svg>
                            Live Tool Scanner
                        </h2>
                        <div className="rounded-2xl overflow-hidden border-2 border-teal-500 relative bg-black aspect-video shadow-[0_0_30px_rgba(20,184,166,0.2)]">
                            <video ref={scanVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                            <canvas ref={scanCanvasRef} className="hidden" />
                            <div className="absolute bottom-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent flex gap-3">
                                <button 
                                    onClick={stopScannerCamera}
                                    className="flex-1 py-3 px-4 bg-teal-950/80 hover:bg-red-500/20 text-white hover:text-red-400 rounded-xl font-bold backdrop-blur-md transition-all border border-teal-800/50 hover:border-red-500/30"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={captureScannerFrame}
                                    className="flex-[2] py-3 px-4 bg-teal-500 hover:bg-teal-400 text-teal-950 rounded-xl font-black shadow-[0_0_20px_rgba(20,184,166,0.4)] transition-all flex items-center justify-center"
                                >
                                    Take Photo
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
