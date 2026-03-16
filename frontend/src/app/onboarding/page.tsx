/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { db } from "@/lib/firebase/config";
import { collection, addDoc } from "firebase/firestore";

type ExperienceLevel = "Beginner" | "Intermediate" | "Expert";

const initialToolsList = [
  "Hammer", "Screwdriver Set", "Drill (18V)", "Duct Tape", "Wrench Set", 
  "Pliers", "Tape Measure", "Stud Finder", "Utility Knife", "Level"
];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [experience, setExperience] = useState<ExperienceLevel>("Beginner");
  
  const [toolsList, setToolsList] = useState<string[]>(initialToolsList);
  const [inventory, setInventory] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Vision Tool Scanner State
  const [isScanning, setIsScanning] = useState(false);
  const [isProcessingImage, setIsProcessingImage] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const handleToolToggle = (tool: string) => {
    setInventory((prev) =>
      prev.includes(tool) ? prev.filter((t) => t !== tool) : [...prev, tool]
    );
  };

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const docRef = await addDoc(collection(db, "users"), {
        experienceLevel: experience,
        inventory: inventory,
        createdAt: new Date(),
      });
      
      if (typeof window !== "undefined") {
        localStorage.setItem("handymate_user_id", docRef.id);
        localStorage.setItem("handymate_experience", experience);
        localStorage.setItem("handymate_inventory", JSON.stringify(inventory));
      }
      
      router.push("/");
    } catch (e: unknown) {
      console.error("Error adding user profile: ", e);
      const msg = e instanceof Error ? e.message : 'Unknown error';
      alert(`Could not save profile to Firebase: ${msg}`);
      setIsSubmitting(false);
    }
  };

  // Camera Management
  const startCamera = async () => {
    setIsScanning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera for scanning.");
      setIsScanning(false);
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsScanning(false);
  };

  const captureAndAnalyze = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    setIsProcessingImage(true);
    
    // Draw current video frame to canvas
    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    }

    // Get base64 JPEG
    const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
    // Strip "data:image/jpeg;base64,"
    const base64Data = dataUrl.split(',')[1];

    try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080";
        const res = await fetch(`${apiUrl}/api/detect-tools`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageBase64: base64Data })
        });

        if (!res.ok) throw new Error("API completely failed");
        
        const detectedTools: string[] = await res.json();
        
        // Merge into toolsList and inventory
        if (Array.isArray(detectedTools)) {
            const newInventory = [...inventory];
            const newToolsList = [...toolsList];
            
            for (const tool of detectedTools) {
                if (!newToolsList.includes(tool)) newToolsList.push(tool);
                if (!newInventory.includes(tool)) newInventory.push(tool);
            }
            
            setToolsList(newToolsList);
            setInventory(newInventory);
        }
    } catch (e) {
        console.error("Failed to analyze image", e);
        alert("Failed to analyze image. Please try again or add tools manually.");
    } finally {
        setIsProcessingImage(false);
        stopCamera();
    }
  };

  // Cleanup camera on unmount
  useEffect(() => {
      return () => stopCamera();
  }, []);

  const handleInlineImageScan = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsProcessingImage(true);
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
                  
                  if (Array.isArray(detectedTools)) {
                      const newInventory = [...inventory];
                      const newToolsList = [...toolsList];
                      
                      for (const tool of detectedTools) {
                          if (!newToolsList.includes(tool)) newToolsList.push(tool);
                          if (!newInventory.includes(tool)) newInventory.push(tool);
                      }
                      
                      setToolsList(newToolsList);
                      setInventory(newInventory);
                  }
              } catch (err) {
                  console.error("Failed to analyze inline image", err);
                  alert("Failed to analyze image. Please try again or add tools manually.");
              } finally {
                  setIsProcessingImage(false);
              }
          };
          img.src = event.target?.result as string;
      };
      reader.readAsDataURL(file);
      e.target.value = ""; // reset input
  };

  return (
    <div className="min-h-screen bg-teal-950 text-teal-50 flex flex-col items-center justify-center p-6 pb-20 relative overflow-x-hidden overflow-y-auto font-sans">
      {/* Decorative background glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full blur-[120px] pointer-events-none transition-colors duration-1000 bg-teal-500/10" />

      <main className="max-w-xl w-full bg-teal-900/40 backdrop-blur-3xl border border-teal-800/50 p-8 rounded-[2rem] shadow-2xl relative z-10 transition-all">
        {/* Subtle glass reflection */}
        <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none rounded-[2rem]" />
        
        <div className="relative z-10">
          <h1 className="text-3xl font-extrabold text-white mb-2 tracking-tight">
            Welcome to <span className="text-teal-400">HandyMate</span>
          </h1>
          <p className="text-teal-200/70 mb-8 font-medium">
            Your personal, AI-powered DIY contractor. Tell us a bit about yourself so HandyMate can tailor its advice.
          </p>

          {/* Step 1: Experience */}
          {step === 1 && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <h2 className="text-xl font-bold mb-5 text-white">What&apos;s your DIY experience level?</h2>
              <div className="space-y-4">
                {(["Beginner", "Intermediate", "Expert"] as ExperienceLevel[]).map((level) => (
                  <button
                    key={level}
                    onClick={() => setExperience(level)}
                    className={`w-full text-left p-5 rounded-2xl border transition-all duration-300 ${
                      experience === level
                        ? "bg-teal-500/20 border-teal-400 shadow-[0_0_20px_rgba(45,212,191,0.2)]"
                        : "bg-teal-950/50 border-teal-800/50 hover:border-teal-600 hover:bg-teal-900/60"
                    }`}
                  >
                    <div className={`font-bold text-lg ${experience === level ? 'text-teal-300' : 'text-white'}`}>{level}</div>
                    <div className="text-sm text-teal-200/60 mt-1.5 leading-relaxed">
                      {level === "Beginner" && "I've hung a picture frame but that's about it."}
                      {level === "Intermediate" && "I own tools and can patch dry-wall or assemble furniture."}
                      {level === "Expert" && "I can frame a wall, plumb a sink, or wire a socket safely."}
                    </div>
                  </button>
                ))}
              </div>

              <button
                onClick={() => setStep(2)}
                className="mt-8 w-full bg-teal-500 hover:bg-teal-400 text-teal-950 font-black py-4 rounded-2xl shadow-[0_0_30px_rgba(20,184,166,0.3)] transition-all hover:shadow-[0_0_40px_rgba(20,184,166,0.5)] hover:-translate-y-1 active:translate-y-0"
              >
                Continue &rarr;
              </button>
            </div>
          )}

          {/* Step 2: Tool Inventory */}
          {step === 2 && (
            <div className="animate-in fade-in slide-in-from-right-8 duration-500">
              <div className="flex justify-between items-start mb-2">
                <h2 className="text-xl font-bold text-white">What&apos;s in your toolbox?</h2>
                {!isScanning && (
                  <div className="flex gap-2">
                      {isProcessingImage ? (
                          <div className="flex items-center justify-center bg-teal-800/50 border border-teal-600/30 text-teal-300 rounded-lg px-4 py-2 text-xs font-bold transition-colors">
                              <span className="w-4 h-4 border-2 border-teal-700 border-t-teal-400 rounded-full animate-spin"></span>
                          </div>
                      ) : (
                          <>
                              <label className="flex items-center justify-center bg-teal-800/50 hover:bg-teal-700/60 border border-teal-600/30 text-teal-300 rounded-lg px-2.5 py-2 cursor-pointer transition-colors" title="Upload Photo">
                                  <input type="file" accept="image/*" className="hidden" onChange={handleInlineImageScan} />
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                                  </svg>
                              </label>
                              <button 
                                onClick={startCamera}
                                className="flex items-center gap-2 bg-teal-800/50 hover:bg-teal-700/60 text-teal-300 text-xs font-bold py-2 px-3 rounded-lg border border-teal-600/30 transition-colors"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                                Scan Tools
                              </button>
                          </>
                      )}
                  </div>
                )}
              </div>
              <p className="text-sm text-teal-200/60 mb-6">HandyMate will only suggest solutions using the tools you actually own.</p>
              
              {isScanning ? (
                <div className="mb-8 rounded-2xl overflow-hidden border-2 border-teal-500 shadow-[0_0_30px_rgba(20,184,166,0.3)] relative bg-black">
                  <video ref={videoRef} autoPlay playsInline muted className="w-full aspect-video object-cover" />
                  <canvas ref={canvasRef} className="hidden" />
                  
                  <div className="absolute bottom-0 w-full p-4 bg-gradient-to-t from-black/80 to-transparent flex gap-3">
                    <button 
                        onClick={stopCamera}
                        className="flex-1 py-3 bg-slate-800/80 hover:bg-slate-700 backdrop-blur-md text-white font-bold rounded-xl transition-colors"
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={captureAndAnalyze}
                        disabled={isProcessingImage}
                        className="flex-1 py-3 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black rounded-xl transition-colors flex items-center justify-center gap-2"
                    >
                        {isProcessingImage ? (
                            <><span className="w-2 h-2 bg-teal-950 rounded-full animate-pulse"></span> Analyzing...</>
                        ) : "Capture"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 mb-8 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                  {toolsList.map((tool) => {
                    const isSelected = inventory.includes(tool);
                    return (
                      <button
                        key={tool}
                        onClick={() => handleToolToggle(tool)}
                        className={`p-3.5 rounded-xl border text-sm font-bold transition-all ${
                          isSelected
                            ? "bg-teal-500/20 border-teal-400 text-teal-300 shadow-[0_0_15px_rgba(45,212,191,0.15)]"
                            : "bg-teal-950/50 border-teal-800/50 text-teal-100/70 hover:border-teal-600 hover:bg-teal-900/60"
                        }`}
                      >
                        {tool}
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-4 mt-8">
                <button
                  onClick={() => setStep(1)}
                  className="w-1/3 bg-teal-950/50 hover:bg-teal-900 border border-teal-800/50 text-teal-100 font-bold py-4 rounded-2xl transition-colors"
                >
                  Back
                </button>
                <button
                  disabled={isSubmitting || isScanning}
                  onClick={handleComplete}
                  className="w-2/3 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black py-4 rounded-2xl shadow-[0_0_30px_rgba(20,184,166,0.3)] transition-all flex justify-center items-center disabled:opacity-50 disabled:hover:shadow-none hover:shadow-[0_0_40px_rgba(20,184,166,0.5)] hover:-translate-y-1 active:translate-y-0"
                >
                  {isSubmitting ? (
                    <span className="animate-pulse">Saving Profile...</span>
                  ) : (
                    "Meet HandyMate"
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
      
      {/* Copyright Footer */}
      <div className="absolute bottom-4 w-full text-center pointer-events-none z-0">
          <p className="text-[10px] text-teal-600/60 font-medium uppercase tracking-widest">
              © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™
          </p>
      </div>
    </div>
  );
}
