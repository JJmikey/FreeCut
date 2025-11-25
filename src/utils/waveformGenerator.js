export async function generateWaveform(file) {
    if (!file.type.startsWith('audio') && !file.type.startsWith('video')) {
        return null;
    }

    try {
        // 1. 讀取檔案
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new AudioContext();
        
        // 2. 解碼音訊 (這步最耗時，所以只在上傳時做一次)
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        
        // 3. 抽樣 (Downsampling)
        // 我們不需要畫出每一個採樣點，那樣太多了。
        // 假設我們每秒只取 50 個點來畫波形就足夠精細了
        const rawData = audioBuffer.getChannelData(0); // 只取左聲道代表
        const samples = 100; // 每秒取樣數 (越大越精細，但數據越大)
        const blockSize = Math.floor(audioBuffer.sampleRate / samples); 
        const waveform = [];

        for (let i = 0; i < samples * audioBuffer.duration; i++) {
            let start = i * blockSize;
            let sum = 0;
            // 算出這段區間的平均音量 (Root Mean Square) 或 最大值
            for (let j = 0; j < blockSize; j++) {
                if (rawData[start + j]) {
                    sum += Math.abs(rawData[start + j]);
                }
            }
            waveform.push(sum / blockSize);
        }
        
        audioCtx.close();
        return waveform; // 回傳一個由 0~1 數字組成的陣列

    } catch (e) {
        console.error("Waveform generation failed:", e);
        return null;
    }
}