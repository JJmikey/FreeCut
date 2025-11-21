import { writable } from 'svelte/store';

// 1. 目前選中的原始素材 (給左側預覽用) - 保持原樣
export const currentVideoSource = writable(null);

// 2. 👇 新增：時間軸的全域時間 (秒)
export const currentTime = writable(0);

// 3. 👇 新增：播放狀態 (是否正在播放中)
export const isPlaying = writable(false);