// src/utils/thumbnailGenerator.js

export async function generateThumbnails(file, fixedDuration) {
    // 1. 圖片直接回傳
    if (file.type.startsWith('image')) {
        return [file]; 
    }

    // 🔥🔥🔥 關鍵修改：放寬檢查條件 🔥🔥🔥
    // 如果 type 是 video 開頭，或是檔名以 .mov 結尾，都允許進入
    const isVideo = file.type.startsWith('video') || file.name.toLowerCase().endsWith('.mov');
    
    if (!isVideo) {
        return [];
    }

    return new Promise(async (resolve) => {
        const video = document.createElement('video');
        video.src = URL.createObjectURL(file);
        video.muted = true;
        video.playsInline = true; // iOS 支援關鍵
        
        // 預設載入
        await new Promise(r => {
            video.onloadeddata = r;
            video.onerror = r; 
        });
        
        let duration = fixedDuration;
        if (!duration || duration === Infinity || isNaN(duration)) duration = 30;

        const count = 5; 
        const blobs = [];

        const canvas = document.createElement('canvas');
        // 針對 MOV 調整：有些 MOV 寬高讀取較慢，給個預設值防止 canvas 報錯
        const vWidth = video.videoWidth || 1280;
        const vHeight = video.videoHeight || 720;
        
        const scale = 150 / vWidth;
        canvas.width = vWidth * scale;
        canvas.height = vHeight * scale;
        const ctx = canvas.getContext('2d');

        // 備用幀 (Backup Frame)
        let backupBlob = null;
        try {
            // MOV 有時候第 0 幀是全黑，我們抓後面一點點 (0.5s)
            video.currentTime = 0.5; 
            await new Promise(r => { video.onseeked = r; setTimeout(r, 1000); });
            
            // 重新確認寬高 (有時候 seek 後才有寬高)
            if (video.videoWidth) {
                canvas.width = video.videoWidth * scale;
                canvas.height = video.videoHeight * scale;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                backupBlob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.6));
            }
        } catch (e) {}

        for (let i = 0; i < count; i++) {
            const time = (duration / count) * i;
            
            try {
                if (!Number.isFinite(time)) throw new Error("Invalid time");
                video.currentTime = time;
                
                // MOV Seek 可能比較慢，給 800ms
                await new Promise((seekResolve, seekReject) => {
                    const timer = setTimeout(() => seekReject('timeout'), 800);
                    video.onseeked = () => { clearTimeout(timer); seekResolve(); };
                });

                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.6));
                blobs.push(blob);

            } catch (e) {
                if (backupBlob) blobs.push(backupBlob);
            }
        }

        URL.revokeObjectURL(video.src);
        
        if (blobs.length === 0 && backupBlob) blobs.push(backupBlob);
        resolve(blobs);
    });
}