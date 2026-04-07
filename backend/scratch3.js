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
                onmessage: (m) => console.log("Received:", Object.keys(m)),
                onerror: (e) => console.log("Error:", e),
                onclose: (e) => console.log("Closed:", e)
            }
        });
        
        console.log("Sending clientContent via SDK method...");
        session.sendClientContent({
            turns: [{role: "user", parts: [{ text: "Hello! I have a repair project." }]}],
            turnComplete: true
        });

        setTimeout(() => {
            console.log("Done checking!");
            session.close();
            process.exit(0);
        }, 5000);
    } catch(e) {
        console.error("Fatal Error", e);
    }
}
main();
