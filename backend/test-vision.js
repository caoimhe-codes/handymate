import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
    try {
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
                "List all DIY tools, hardware, or materials visible in this image. Return ONLY a JSON array of strings.",
                {
                    inlineData: {
                        mimeType: "image/jpeg",
                        data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
                    }
                }
            ],
        });
        console.log("Success:", response.text);
    } catch (e) {
        console.error("Error:", e);
    }
}

test();
