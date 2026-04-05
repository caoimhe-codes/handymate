import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function testResumeCall() {
    const experience = "Beginner";
    const inventory = "Hammer, Drill";
    const activeProjectSummary = "Fixing the leaky sink";
    const activeProjectSteps = JSON.stringify(["Turn off water", "Unscrew valve"]);
    
    let baseInstructions = `You are HandyMate, an expert contractor with 30 years experience. Your tone is direct, encouraging, concise, and safety-focused. CRITICAL RULES: 1. You MUST introduce yourself as HandyMate the moment you connect. 2. Wait for user to show the problem. 3. Diagnose first. 4. Give instructions strictly one step at a time. 5. Politely interrupt if the user is seen making a mistake on camera. 6. If the user interrupts you, stop your current thought immediately, genuinely acknowledge the interruption, and address their new point directly without repeating the previous step.\n\nIMPORTANT CONTEXT: The user has a ${experience} DIY experience level. Tailor your explanations accordingly. They currently have the following tools available: ${inventory}. Try to suggest solutions using these tools first. If they do not have the necessary tools for the job, clearly list exactly what tools they need to buy or borrow before they can proceed.`;
    
    let stepsStr = "None";
    const steps = JSON.parse(activeProjectSteps);
    stepsStr = steps.map((s, idx) => `${idx+1}. ${s}`).join("\n");
    
    baseInstructions += `\n\n[RESUMING EXISTING TASK]: The user is resuming a previously paused task. The task summary is: "${activeProjectSummary}". The steps previously generated for this task are:\n${stepsStr}\nUse this context to seamlessly pick up where they left off.`;
    
    let initialGreeting = `"Hello! I am ready. Please introduce yourself as HandyMate and acknowledge that we are resuming work on: ${activeProjectSummary}."`;
    
    console.log("Connecting...");
    try {
        const session = await ai.live.connect({
            model: 'gemini-2.5-flash-native-audio-latest',
            config: {
                systemInstruction: { parts: [{ text: baseInstructions }] },
                responseModalities: ["AUDIO"]
            },
            callbacks: {
                onopen: () => console.log('SDK: Connected'),
                onmessage: (msg) => console.log('SDK Message:', JSON.stringify(msg, null, 2)),
                onerror: (e) => console.error('SDK Error:', e),
                onclose: () => console.log('SDK Closed')
            }
        });

        console.log("Sending initial greeting...");
        session.sendClientContent({
            turns: [{
                parts: [{ text: initialGreeting }],
                role: "user"
            }],
            turnComplete: true
        });

        // Wait 5 seconds to see if anything comes back
        await new Promise(r => setTimeout(r, 5000));
        session.close();
    } catch (err) {
        console.error("Connection Failed:", err);
    }
}

testResumeCall();
