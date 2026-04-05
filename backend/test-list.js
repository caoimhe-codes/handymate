import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config({ override: true });

const apiKey = process.env.GEMINI_API_KEY;
async function getModels() {
    const apiKey = process.env.GEMINI_API_KEY;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const data = await res.json();
    for (const m of data.models) {
        if (m.supportedGenerationMethods && m.supportedGenerationMethods.includes("bidiGenerateContent")) {
            console.log("BIDI FOUND IN:", m.name);
        }
    }
}
getModels();
