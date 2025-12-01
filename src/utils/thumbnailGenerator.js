// src/utils/thumbnailGenerator.js

export async function generateThumbnails(file, fixedDuration) {
    // 1. 圖片直接回傳
    if (file.type.startsWith('image')) {
        return [file]; 
    }

    // 寬鬆檢查：支援 video type 或是 .mov 檔名
    const isVideo = file.type.startsWith('video') || file.name.toLowerCase().endsWith('.mov');
    
    if (!isVideo) {
        return [];
    }

    return new Promise(async (resolve) => {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true; // iOS 支援關鍵
        
        // 等待影片 metadata 載入
        await new Promise(r => {
            video.onloadedmetadata = r; // 改用 onloadedmetadata 通常比較快取得 duration
            video.onerror = r; 
        });
        
        // 🔥 取得正確時長：優先用傳入的，沒有就用影片自身的，再沒有就預設 30
        let duration = fixedDuration || video.duration;
        if (!duration || duration === Infinity || isNaN(duration)) duration = 30;

        // 🔥🔥🔥 關鍵修改：動態決定數量 🔥🔥🔥
        // 邏輯：每 5 秒一張圖。
        // 下限：最少 5 張（短影片才不會空空的）。
        // 上限：最多 30 張（防止長影片生成幾百張導致瀏覽器崩潰）。
        const count = Math.min(30, Math.max(5, Math.ceil(duration / 5)));

        const blobs = [];
        const canvas = document.createElement('canvas');
        
        // 針對 MOV 調整：有些 MOV 寬高讀取較慢，給個預設值防止 canvas 報錯
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;
        
        // 縮圖寬度固定 150px 左右，高度按比例
        const scale = 150 / vWidth;
        canvas.width = vWidth * scale;
        canvas.height = vHeight * scale;
        const ctx = canvas.getContext('2d');

        // 備用幀 (Backup Frame)：防止某個時間點 seek 失敗變黑畫面
        let backupBlob = null;
        try {
            // 先抓第 0.5 秒當作備用圖
            video.currentTime = 0.5; 
            await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
            
            // 重新確認寬高 (有時候 seek 後才有寬高)
            if (video.videoWidth) {
                // 如果第一次沒抓到寬高，這裡更新一下
                const currentScale = 150 / video.videoWidth;
                canvas.width = video.videoWidth * currentScale;
                canvas.height = video.videoHeight * currentScale;
                
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                backupBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.6));
            }
        } catch (e) {
            console.warn("Backup frame failed", e);
        }

        // 開始迴圈截圖
        for (let i = 0; i < count; i++) {
            const time = (duration / count) * i;
            
            try {
                if (!Number.isFinite(time)) throw new Error("Invalid time");
                video.currentTime = time;
                
                // Seek 等待：最多等 800ms，超過就用備用圖
                await new Promise((seekResolve, seekReject) => {
                    const timer = setTimeout(() => seekReject('timeout'), 800);
                    video.onseeked = () => { clearTimeout(timer); seekResolve(); };
                });

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.6));
                blobs.push(blob);
                
                // 更新備用圖為最新成功的一張 (這樣如果下一張失敗，會用上一張來補，比較自然)
                backupBlob = blob;

            } catch (e) {
                // 如果失敗 (timeout 或解碼錯誤)，塞入備用圖
                if (backupBlob) blobs.push(backupBlob);
            }
        }

        URL.revokeObjectURL(video.src);
        
        // 極端情況防護
        if (blobs.length === 0 && backupBlob) blobs.push(backupBlob);
        
        resolve(blobs);
    });
}