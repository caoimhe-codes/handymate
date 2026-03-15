/* © 2026 Lonrú Consulting Ltd. | Active Architecture™ Powered by Lonrú Studios™ */
"use client";

import { useState, useEffect } from "react";
import { db } from "@/lib/firebase/config";
import { collection, addDoc } from "firebase/firestore";
import { toJpeg } from "html-to-image";
import Image from "next/image";

export default function FeedbackWidget() {
    const [isOpen, setIsOpen] = useState(false);
    const [message, setMessage] = useState("");
    const [imageStr, setImageStr] = useState<string | null>(null);
    const [isCapturing, setIsCapturing] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitted, setSubmitted] = useState(false);
    const [userId, setUserId] = useState<string | null>(null);

    useEffect(() => {
        if (typeof window !== "undefined") {
            const storedId = localStorage.getItem("handymate_user_id");
            if (storedId) setUserId(storedId);
        }
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!message.trim()) return;

        setIsSubmitting(true);
        try {
            // Log to users/{userId}/feedback if session exists, otherwise root feedback collection
            const parentCollection = userId 
                ? collection(db, "users", userId, "feedback")
                : collection(db, "feedback");
            
            await addDoc(parentCollection, {
                message: message.trim(),
                screenshot: imageStr,
                createdAt: new Date(),
                status: "new"
            });
            
            setSubmitted(true);
            setTimeout(() => {
                setIsOpen(false);
                setTimeout(() => {
                    setSubmitted(false);
                    setMessage("");
                    setImageStr(null);
                }, 300);
            }, 2000);
        } catch (error) {
            console.error("Error submitting feedback:", error);
            alert("Failed to submit feedback. Please try again.");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleOpenToggle = async () => {
        if (!isOpen) {
            setIsOpen(true);
            setIsCapturing(true);
            try {
                // html-to-image natively renders using SVG <foreignObject> avoiding CSS parse crashes
                const dataUrl = await toJpeg(document.body, {
                    quality: 0.6,
                    height: window.innerHeight,
                    width: window.innerWidth,
                    backgroundColor: '#042f2e', // tailwind teal-950 fallback
                    skipFonts: true, // prevents cross-origin font fetch crashing
                    filter: (node) => {
                        // ignore the feedback widget itself from the screenshot
                        if (node.id === 'feedback-widget-content') return false;
                        // explicitly ignore Video/Camera elements as MediaStreams taint canvases and block data URL exports
                        if (node.tagName?.toUpperCase() === 'VIDEO') return false;
                        if (node.tagName?.toUpperCase() === 'IFRAME') return false;
                        return true;
                    }
                });
                
                setImageStr(dataUrl);
            } catch (e) {
                console.error("Screenshot failed", e);
            } finally {
                setIsCapturing(false);
            }
        } else {
            setIsOpen(false);
        }
    };

    return (
        <div className="fixed bottom-6 right-6 z-50 font-sans">
            {/* Modal Popover */}
            {isOpen && (
                <div id="feedback-widget-content" className="absolute bottom-16 right-0 mb-2 w-80 bg-teal-900/90 backdrop-blur-2xl border border-teal-800/50 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 origin-bottom-right">
                    <div className="p-4 border-b border-teal-800/50 bg-teal-950/50">
                        <div className="flex justify-between items-center">
                            <h3 className="text-teal-50 font-bold">Send Feedback</h3>
                            <button 
                                onClick={() => setIsOpen(false)}
                                className="text-teal-400/50 hover:text-teal-300 transition-colors p-1"
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                    </div>
                    
                    <div className="p-4">
                        {submitted ? (
                            <div className="flex flex-col items-center justify-center py-6 text-center text-teal-300">
                                <svg className="w-12 h-12 mb-3 text-teal-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="font-bold">Thank you!</p>
                                <p className="text-sm text-teal-400/70 mt-1">Your feedback helps us improve.</p>
                            </div>
                        ) : (
                            <form onSubmit={handleSubmit}>
                                <div className="space-y-3">
                                    <textarea
                                        value={message}
                                        onChange={(e) => setMessage(e.target.value)}
                                        placeholder="Tell us what you think, report a bug, or suggest a feature..."
                                        className="w-full bg-teal-950/60 border border-teal-800/50 rounded-xl p-3 text-teal-50 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 placeholder:text-teal-700/80 resize-none h-24 custom-scrollbar shadow-inner"
                                        required
                                        autoFocus
                                    />
                                    
                                    <div className="flex items-center gap-3">
                                        {isCapturing ? (
                                            <div className="relative h-10 flex-1 bg-teal-950/40 border border-teal-800/50 rounded-lg overflow-hidden flex items-center justify-center px-2 gap-2">
                                                <span className="w-3 h-3 border-2 border-teal-700 border-t-teal-400 rounded-full animate-spin"></span>
                                                <span className="text-xs text-teal-400/80 font-medium">Capturing screen...</span>
                                            </div>
                                        ) : imageStr ? (
                                            <div className="relative h-10 flex-1 bg-teal-950/40 border border-teal-800/50 rounded-lg overflow-hidden flex items-center px-2 gap-2">
                                                <div className="relative h-8 w-8 shrink-0">
                                                    <Image src={imageStr} fill className="object-cover rounded shadow-sm border border-teal-700" alt="Preview" unoptimized />
                                                </div>
                                                <span className="text-xs text-teal-300 font-medium truncate">Auto-screenshot attached</span>
                                                <button type="button" onClick={() => setImageStr(null)} className="ml-auto text-teal-500 hover:text-red-400 p-1">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="text-xs text-teal-500/70 italic flex-1 truncate">
                                                Could not capture screen.
                                            </div>
                                        )}
                                    </div>
                                </div>
                                
                                <button
                                    type="submit"
                                    disabled={isSubmitting || !message.trim()}
                                    className="w-full mt-4 bg-teal-500 hover:bg-teal-400 text-teal-950 font-black py-2.5 rounded-xl transition-all disabled:opacity-50 disabled:hover:bg-teal-500 shadow-[0_0_15px_rgba(20,184,166,0.2)]"
                                >
                                    {isSubmitting ? "Sending..." : "Submit Feedback"}
                                </button>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* Floating FAB Button */}
            <button
                onClick={handleOpenToggle}
                className={`w-14 h-14 rounded-full flex items-center justify-center shadow-[0_0_30px_rgba(20,184,166,0.4)] transition-all duration-300 hover:scale-110 active:scale-95 ${isOpen ? 'bg-teal-600 text-teal-50' : 'bg-teal-500 text-teal-950'}`}
                title="Provide Feedback"
            >
                {isOpen ? (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                ) : (
                    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                )}
            </button>
        </div>
    );
}
