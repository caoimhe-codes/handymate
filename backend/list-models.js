import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY});

async function run() {
    try {
        const response = await ai.models.list();
        let models = [];
        if (response.models) models = response.models;
        else if (response[Symbol.asyncIterator]) {
            for await (const m of response) {
                models.push(m);
            }
        }
        for (const m of models) {
            if (m.name.includes('gemini-2.0')) {
                console.log(m.name, m.supportedGenerationMethods);
            }
        }
    } catch (e) {
        console.error(e);
    }
}
run();
