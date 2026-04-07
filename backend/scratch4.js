import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config({ override: true });

const ai = new GoogleGenAI({ 
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { apiVersion: 'v1alpha' }
});

async function main() {
    console.log("Connecting...");
    try {
        const session = await ai.live.connect({
            model: 'gemini-3.1-flash-live-preview',
            config: {
                systemInstruction: { parts: [{ text: "Hello" }] },
                responseModalities: ["AUDIO"]
            },
            callbacks: {
                onmessage: (m) => console.log("Received data"),
                onerror: (e) => console.log("Error:", e),
                onclose: (e) => console.log("Closed:", e)
            }
        });
        
        console.log("Sending valid new realtimeInput structure via raw socket...");
        session.conn.send(JSON.stringify({
            realtimeInput: {
                audio: {
                    mimeType: "audio/pcm;rate=16000",
                    data: "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=" // dummy
                }
            }
        }));

        setTimeout(() => {
            console.log("Still connected!");
            session.close();
            process.exit(0);
        }, 3000);
    } catch(e) {
        console.error("Fatal Error", e);
    }
}
main();
