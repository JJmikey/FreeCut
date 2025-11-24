// src/stores/timelineStore.js
import { writable, get } from 'svelte/store'; // 記得引入 get

export const mainTrackClips = writable([]);
export const audioTrackClips = writable([]);


// 🔥 修改：改為複數，儲存 ID 陣列
export const selectedClipIds = writable([]); 


export const draggedFile = writable(null);

// 🔥 新增：儲存所有已上傳的素材 (Media Library)
export const uploadedFiles = writable([]); 

export const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

// 🔥 修改後的 helper：加入 volume 和 rawFile 參數
export const createClip = (fileData, startOffset, rawFile = null) => ({
    id: generateId(),
    fileUrl: fileData.url,
    name: fileData.name,
    type: fileData.type,
    startOffset: startOffset,
    duration: fileData.duration || 5,
    sourceDuration: fileData.duration || 5,
    mediaStartOffset: 0,
    volume: 1.0,      // 🔥 新增：音量屬性
    file: rawFile     // 🔥 新增：原始檔案 (給 IndexedDB 用)
});

// 🔥 新增：分割片段的核心邏輯
export function splitClip(clipId, splitTime) {
    // 1. 嘗試在 Main Track 找
    let track = 'main';
    let clips = get(mainTrackClips);
    let clipIndex = clips.findIndex(c => c.id === clipId);

    // 2. 沒找到就去 Audio Track 找
    if (clipIndex === -1) {
        track = 'audio';
        clips = get(audioTrackClips);
        clipIndex = clips.findIndex(c => c.id === clipId);
    }

    if (clipIndex === -1) return; // 找不到

    const clip = clips[clipIndex];

    // 3. 檢查分割點是否有效 (必須在片段範圍內，且留有 0.1s 緩衝)
    const clipEnd = clip.startOffset + clip.duration;
    if (splitTime <= clip.startOffset + 0.1 || splitTime >= clipEnd - 0.1) {
        console.warn("分割點不在片段有效範圍內");
        return;
    }

    // 4. 計算前半段和後半段的參數
    
    // [前半段 A]
    // Start: 不變
    // Duration: 分割點 - 開始點
    const newDurationA = splitTime - clip.startOffset;

    // [後半段 B]
    // Start: 分割點
    // Duration: 原本結束點 - 分割點
    // MediaStart: 原本MediaStart + 前半段長度 (這是關鍵！確保畫面接得上)
    const newDurationB = clipEnd - splitTime;
    const newMediaStartB = (clip.mediaStartOffset || 0) + newDurationA;

    // 更新 Clip A (直接修改原本的物件)
    const updatedClipA = { 
        ...clip, 
        duration: newDurationA 
    };

    // 建立 Clip B (後半段)
    const newClipB = {
        ...clip,
        id: generateId(), // 新 ID
        startOffset: splitTime,
        duration: newDurationB,
        mediaStartOffset: newMediaStartB,
        // 繼承原本的屬性 (音量、檔案等)
        volume: clip.volume, 
        file: clip.file 
    };

    // 5. 寫回 Store (插入到原本的位置後面)
    const newClipsList = [...clips];
    newClipsList[clipIndex] = updatedClipA; // 更新 A
    newClipsList.splice(clipIndex + 1, 0, newClipB); // 插入 B

    if (track === 'main') {
        mainTrackClips.set(newClipsList);
    } else {
        audioTrackClips.set(newClipsList);
    }
}