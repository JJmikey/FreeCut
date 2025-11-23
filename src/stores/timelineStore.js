// src/stores/timelineStore.js
import { writable } from 'svelte/store';

export const mainTrackClips = writable([]);
export const audioTrackClips = writable([]);

export const generateId = () => '_' + Math.random().toString(36).substr(2, 9);

// 可以在這裡加一個 helper 確保新 clip 結構一致 (選用，但建議)
export const createClip = (file, startOffset) => ({
    id: generateId(),
    fileUrl: file.url,
    name: file.name,
    type: file.type,
    startOffset: startOffset,
    duration: file.duration || 5,
    sourceDuration: file.duration || 5,
    mediaStartOffset: 0 // 🔥 新增：預設從影片第 0 秒開始播
});