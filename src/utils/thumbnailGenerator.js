// src/utils/thumbnailGenerator.js

/**
 * 產生影片縮圖（純前端）
 *
 * @param {File|Blob} file              - 來源檔（video 或 image）
 * @param {Object}    opts
 * @param {number}    [opts.fixedDuration]      - 外部指定時長（秒），未提供則用影片 metadata
 * @param {number}    [opts.targetCount]        - 直接指定要幾張縮圖（優先於 secondsPerThumb 規則）
 * @param {number}    [opts.secondsPerThumb=5]  - 每幾秒取一張
 * @param {number}    [opts.minThumbs=10]       - 最少張數
 * @param {number}    [opts.maxThumbs=120]      - 最多張數（防止長片炸掉）
 * @param {number}    [opts.thumbWidth=150]     - 單張縮圖目標寬度（px），高度按比例
 * @returns {Promise<Blob[]>}                   - 回傳縮圖 Blob 陣列（jpeg）
 */
export async function generateThumbnails(file, opts = {}) {
    const {
      fixedDuration,
      targetCount,
      secondsPerThumb = 5,
      minThumbs = 2,
      maxThumbs = 120,
      thumbWidth = 150
    } = opts;
  
    // 1) 圖片直接回傳（與舊行為一致）
    if (file && file.type && file.type.startsWith('image')) {
      return [file];
    }
  
    // 2) 僅接受 video（含 mov 副檔名）
    const name = (file?.name || '').toLowerCase();
    const isVideo =
      (file?.type && file.type.startsWith('video')) ||
      name.endsWith('.mov') ||
      name.endsWith('.m4v') ||
      name.endsWith('.mp4') ||
      name.endsWith('.webm');
  
    if (!isVideo) return [];
  
    // ---- 主要流程 ----
    return new Promise(async (resolve) => {
      const video = document.createElement('video');
      const url = URL.createObjectURL(file);
      video.src = url;
      video.muted = true;
      video.playsInline = true; // iOS
  
      // 先拿 metadata
      await new Promise((r) => {
        video.onloadedmetadata = r;
        video.onerror = r;
      });
  
      // 時長
      let duration = fixedDuration || video.duration;
      if (!duration || !isFinite(duration)) duration = 30;
  
      // 🔥🔥🔥 修改開始：動態縮圖數量計算 🔥🔥🔥
      let count = targetCount;

      if (!count) {
        // 策略 A: 極短影片 (< 10秒)
        // 邏輯: 採用「高密度」，每 1 秒一張圖。
        // 效果: 3秒影片 -> 3張圖；5秒影片 -> 5張圖。
        // 限制: 最少給 2 張 (確保有一頭一尾)。
        if (duration <= 10) {
            count = Math.max(2, Math.ceil(duration)); 
        } 
        // 策略 B: 一般與長影片 (>= 10秒)
        // 邏輯: 採用「低密度」，每 5 秒 (secondsPerThumb) 一張圖。
        // 效果: 60秒影片 -> 12張圖；30分鐘影片 -> 限制在 120 張。
        // 限制: 最少給 5 張，最多給 maxThumbs 張。
        else {
            const baseCount = Math.ceil(duration / Math.max(1, secondsPerThumb));
            // 這裡把 minThumbs 寫死為 5，避免設定檔傳入的 10 影響中短影片
            count = Math.min(maxThumbs, Math.max(5, baseCount));
        }
    }
    // 🔥🔥🔥 修改結束 🔥🔥🔥
      
  
      const blobs = [];
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
      // 尺寸（先給預設，避免 0*0）
      let vW = video.videoWidth || 1280;
      let vH = video.videoHeight || 720;
      const scale = thumbWidth / vW;
      canvas.width = Math.max(1, Math.round(vW * scale));
      canvas.height = Math.max(1, Math.round(vH * scale));
  
      // 嘗試先抓一張備援幀
      let backupBlob = null;
      try {
        await seekTo(video, Math.min(0.5, duration * 0.02)); // 前 2% 或 0.5s
        // 若 metadata 後才拿到正確寬高，補調整一次
        if (video.videoWidth && video.videoHeight) {
          vW = video.videoWidth;
          vH = video.videoHeight;
          const s = thumbWidth / vW;
          canvas.width = Math.max(1, Math.round(vW * s));
          canvas.height = Math.max(1, Math.round(vH * s));
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        backupBlob = await toBlob(canvas, 'image/jpeg', 0.7);
      } catch (_) {
        // ignore
      }
  
      // 逐張擷取
      for (let i = 0; i < count; i++) {
        // 均勻取樣（包含起點，不含終點，避免最後一張 seek 越界）
        const t = Math.min(duration - 0.001, (duration / count) * i);
  
        try {
          await seekTo(video, t, 900); // 900ms 超時
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const blob = await toBlob(canvas, 'image/jpeg', 0.7);
          blobs.push(blob);
          backupBlob = blob; // 更新備援
        } catch (_) {
          if (backupBlob) blobs.push(backupBlob);
        }
      }
  
      URL.revokeObjectURL(url);
      if (blobs.length === 0 && backupBlob) blobs.push(backupBlob);
      resolve(blobs);
    });
  }
  
  // ---------- Helpers ----------
  
  function toBlob(canvas, type = 'image/jpeg', quality = 0.7) {
    return new Promise((res) => canvas.toBlob(res, type, quality));
  }
  
  /**
   * 在影片上安全地 seek 到指定時間點，提供 timeout 保護。
   * @param {HTMLVideoElement} video
   * @param {number} timeSec
   * @param {number} timeoutMs
   */
  function seekTo(video, timeSec, timeoutMs = 800) {
    return new Promise((resolve, reject) => {
      let done = false;
  
      const onSeeked = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
  
      const onError = () => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('seek error'));
      };
  
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        cleanup();
        reject(new Error('seek timeout'));
      }, timeoutMs);
  
      const cleanup = () => {
        clearTimeout(timer);
        video.onseeked = null;
        video.onerror = null;
      };
  
      video.onseeked = onSeeked;
      video.onerror = onError;
  
      // 有些瀏覽器對相同時間不觸發 seeked，微調 0.001s 以確保觸發
      const t = Math.max(0, Math.min(video.duration || Infinity, timeSec));
      video.currentTime = t + 0.0001;
    });
  }
  