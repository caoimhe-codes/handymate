const assert = require('assert');

// Simulate microphone array of 4096 size at 48000 Hz targetting 16000
const currentRate = 48000;
let inputData = new Float32Array(4096);
inputData.fill(0.5);

if (currentRate !== 16000) {
    const ratio = currentRate / 16000; // 3
    const newLength = Math.round(inputData.length / ratio);
    const downsampled = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const exactSrcIdx = i * ratio;
        const leftIdx = Math.floor(exactSrcIdx);
        const rightIdx = Math.min(leftIdx + 1, inputData.length - 1);
        const fraction = exactSrcIdx - leftIdx;
        downsampled[i] = inputData[leftIdx] * (1 - fraction) + inputData[rightIdx] * fraction;
    }
    inputData = downsampled;
}
console.log("Downsampled length:", inputData.length, "Value:", inputData[0]);

// Output test
const float32 = new Float32Array(24000); // 1 second of audio
float32.fill(0.5);
const targetRate = 16000;
let finalBuffer = float32;

if (targetRate !== 24000) {
    const ratio = 24000 / targetRate; // 1.5
    const newLength = Math.round(float32.length / ratio);
    finalBuffer = new Float32Array(newLength);
    for (let i = 0; i < newLength; i++) {
        const exactSrcIdx = i * ratio;
        const leftIdx = Math.floor(exactSrcIdx);
        const rightIdx = Math.min(leftIdx + 1, float32.length - 1);
        const fraction = exactSrcIdx - leftIdx;
        finalBuffer[i] = float32[leftIdx] * (1 - fraction) + float32[rightIdx] * fraction;
    }
}
console.log("Upsampled length:", finalBuffer.length, "Value:", finalBuffer[0]);
