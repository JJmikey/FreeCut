import { writable, get } from 'svelte/store';

export const mainTrackClips = writable([]);
export const audioTrackClips = writable([]);
export const textTrackClips = writable([]);
export const selectedClipIds = writable([]);
export const draggedFile = writable(null);

// 🔥 新增：專案設定
export const projectSettings = writable({
    width: 1280,
    height: 720,
    aspectRatio: '16:9',
    // 🔥🔥🔥 新增：背景設定 🔥🔥🔥
    backgroundMode: 'black', // 'black', 'white', 'color', 'blur'
    backgroundColor: '#000000'
});

// 新增：素材庫 Store
export const uploadedFiles = writable([]); 

export const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

export const createClip = (fileData, startOffset, rawFile = null) => ({
    id: generateId(),
    fileUrl: fileData.url,
    name: fileData.name,
    type: fileData.type,
    startOffset: startOffset,
    duration: fileData.duration || 5,
    sourceDuration: fileData.type.startsWith('image') ? Infinity : (fileData.duration || 5),
    mediaStartOffset: 0,
    volume: 1.0,
    file: rawFile,
    thumbnailUrls: fileData.thumbnailUrls,
    // Transform
    scale: 1.0,
    positionX: 0,
    positionY: 0,

    // 🔥 新增動畫屬性
    animIn: 'none',          // 'none', 'fade', 'zoom'
    animInDuration: 1.0,     // 進場秒數
    animOut: 'none',         // 'none', 'fade', 'zoom'
    animOutDuration: 1.0     // 退場秒數
});

    // Helper: 建立文字 Clip
    export const createTextClip = (startOffset) => ({
        id: generateId(),
        type: 'text',
        name: 'Text',
        startOffset: startOffset,
        duration: 3,
        sourceDuration: Infinity,
        mediaStartOffset: 0,
        text: 'New Text',
        fontSize: 40,
        color: '#ffffff',  // 白字
        fontWeight: 'normal', // 新增屬性，預設不加粗
         // 🔥 新增：字體屬性 (預設用 Arial)
         fontFamily: '"Microsoft JhengHei", "PingFang TC", Arial, sans-serif',
        x: 50, 
        y: 50,
        volume: 1.0 ,
        // 🔥 新增：背景與邊框屬性
        showBackground: true,      // 是否顯示背景
        backgroundColor: '#00000080', // 黑色 + 50% 透明度 (80是Hex的透明度)
        strokeWidth: 0,             // 描邊寬度 (0 代表無)
        strokeColor: '#000000' ,     // 描邊顏色
        // 🔥 文字也要有動畫
        animIn: 'none',
        animInDuration: 1.0,
        animOut: 'none',
        animOutDuration: 1.0
    });
    

// 🔥🔥🔥 核心邏輯：解決重疊與推擠 🔥🔥🔥
export function resolveOverlaps(clips, activeId = null) {
    if (clips.length === 0) return [];

    // 1. 排序
    const sortedClips = [...clips].sort((a, b) => {
        if (a.id === b.id) return 0;
        const diff = a.startOffset - b.startOffset;
        if (Math.abs(diff) < 0.01) { // 提高精度判定
            if (a.id === activeId) return -1; 
            if (b.id === activeId) return 1; 
        }
        return diff;
    });

    // 2. 推擠
    for (let i = 1; i < sortedClips.length; i++) {
        const prevClip = sortedClips[i - 1];
        const currentClip = sortedClips[i];
        const prevEnd = prevClip.startOffset + prevClip.duration;
        
        // 容錯：如果重疊超過 0.001s 才推擠，避免浮點數誤差
        if (currentClip.startOffset < prevEnd - 0.001) {
            currentClip.startOffset = prevEnd; 
        }
    }
    return sortedClips;
}

// 🔥🔥🔥 修復：Split Logic (加入 resolveOverlaps) 🔥🔥🔥
export function splitClip(clipId, splitTime) {
    let track = 'main';
    let store = mainTrackClips;
    let clips = get(mainTrackClips);
    let clipIndex = clips.findIndex(c => c.id === clipId);

    if (clipIndex === -1) {
        track = 'audio';
        store = audioTrackClips;
        clips = get(audioTrackClips);
        clipIndex = clips.findIndex(c => c.id === clipId);
    }
    
    if (clipIndex === -1) {
        track = 'text';
        store = textTrackClips;
        clips = get(textTrackClips);
        clipIndex = clips.findIndex(c => c.id === clipId);
    }

    if (clipIndex === -1) return;

    const clip = clips[clipIndex];
    const clipEnd = clip.startOffset + clip.duration;

    // 檢查分割點有效性
    if (splitTime <= clip.startOffset + 0.1 || splitTime >= clipEnd - 0.1) {
        alert("Cannot split: too close to the edge");
        return;
    }

    // 計算新參數
    const newDurationA = splitTime - clip.startOffset;
    const newDurationB = clipEnd - splitTime;
    const newMediaStartB = (clip.mediaStartOffset || 0) + newDurationA;

    // Clip A (更新原片段)
    const updatedClipA = { 
        ...clip, 
        duration: newDurationA 
    };

    // Clip B (新片段)
    const newClipB = {
        ...clip,
        id: generateId(),
        startOffset: splitTime,
        duration: newDurationB,
        mediaStartOffset: newMediaStartB,
        // 複製屬性
        volume: clip.volume, 
        file: clip.file,
        text: clip.text, 
        thumbnailUrls: clip.thumbnailUrls,
        scale: clip.scale,
        positionX: clip.positionX,
        positionY: clip.positionY,
        thumbnails: clip.thumbnails, // 記得複製 blob
        waveform: clip.waveform
    };

    // 更新陣列
    let newClipsList = [...clips];
    newClipsList[clipIndex] = updatedClipA;
    newClipsList.splice(clipIndex + 1, 0, newClipB);

    // 🔥 關鍵：執行重排，確保沒有浮點數誤差導致的重疊
    // 我們傳入 newClipB.id 作為 activeId，確保它排在後面
    newClipsList = resolveOverlaps(newClipsList, newClipB.id);

    store.set(newClipsList);
}