// src/utils/gifHelper.js

export async function decodeGifFrames(url) {
    // 1. 下載 GIF 檔案資料
    const response = await fetch(url);
    const buffer = await response.arrayBuffer(); // 轉成 ArrayBuffer
    
    // 2. 建立 ImageDecoder (WebCodecs API)
    // type: 'image/gif' 告訴瀏覽器這是 GIF
    const decoder = new ImageDecoder({ 
        data: new DataView(buffer), 
        type: 'image/gif' 
    });

    const frames = [];
    let accumulatedDuration = 0;

    // 3. 解碼每一幀
    // decoder.tracks.selectedTrack.frameCount 是總幀數
    const frameCount = decoder.tracks.selectedTrack.frameCount;

    for (let i = 0; i < frameCount; i++) {
        const result = await decoder.decode({ frameIndex: i });
        
        // result.image 是一個 VideoFrame 物件
        // duration 是微秒 (microseconds)，我們轉成秒
        const duration = result.image.duration ? result.image.duration / 1_000_000 : 0.1; // 預設 0.1s 防呆
        
        frames.push({
            image: result.image, // 這是可以直接畫在 Canvas 上的 Bitmap
            duration: duration,
            startTime: accumulatedDuration
        });

        accumulatedDuration += duration;
    }

    return {
        frames,
        totalDuration: accumulatedDuration
    };
}