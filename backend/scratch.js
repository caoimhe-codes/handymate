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
            }
        });
        
        console.log("SESSION KEYS:", Object.keys(session));
        
        let wsRef = null;
        for (const key of Object.keys(session)) {
            if (session[key] && typeof session[key] === 'object' && session[key].constructor && session[key].constructor.name === 'WebSocket') {
                console.log(`Found WebSocket at session.${key}`);
                wsRef = session[key];
            }
        }
        
        // Also check if any properties have .send
        for (const key of Object.keys(session)) {
            if (session[key] && typeof session[key].send === 'function') {
                 console.log(`Found .send at session.${key}.send`);
            }
        }
        
        console.log("Send methods:", typeof session.send, typeof session.sendRealtimeInput, typeof session.sendClientContent);

        session.close();
    } catch(e) {
        console.error("Error", e);
    }
}
main();
