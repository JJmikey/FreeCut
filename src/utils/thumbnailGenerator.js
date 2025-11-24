// src/utils/thumbnailGenerator.js

export async function generateThumbnails(file) {
    // 1. 圖片直接回傳單張陣列
    if (file.type.startsWith('image')) {
        return [file]; 
    }

    if (!file.type.startsWith('video')) {
        return [];
    }

    return new Promise(async (resolve) => {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true;
        
        // 等待 Metadata 載入以獲取 duration
        await new Promise(r => video.onloadedmetadata = r);
        
        const duration = video.duration;
        // 🔥 設定要抓幾張圖 (例如 5 張)
        const count = 5; 
        const blobs = [];

        const canvas = document.createElement('canvas');
        // 縮圖高度固定，寬度按比例，這裡設低一點省記憶體
        const scale = 100 / video.videoHeight;
        canvas.width = video.videoWidth * scale;
        canvas.height = 100;
        const ctx = canvas.getContext('2d');

        // 🔥 迴圈抓圖
        for (let i = 0; i < count; i++) {
            // 計算時間點：分佈在 0% ~ 100% 之間
            const time = (duration / count) * i;
            video.currentTime = time;

            // 等待 seek 完成
            await new Promise(r => video.onseeked = r);

            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            
            const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.6));
            if (blob) blobs.push(blob);
        }

        URL.revokeObjectURL(video.src);
        resolve(blobs); // 回傳 Blob 陣列
    });
}