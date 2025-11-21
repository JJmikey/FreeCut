// src/stores/timelineStore.js
import { writable } from 'svelte/store';

// 這裡儲存所有的片段 (Clips)
// 格式範例: { id: 1, fileUrl: '...', type: 'video', startOffset: 0, duration: 5 }
export const mainTrackClips = writable([]);

// 用來產生唯一 ID 的輔助函數
export const generateId = () => '_' + Math.random().toString(36).substr(2, 9);