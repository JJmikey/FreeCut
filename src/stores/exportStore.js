import { writable } from 'svelte/store';

// 是否正在導出中
export const isExporting = writable(false);

// 用來觸發導出事件的信號
export const startExportTrigger = writable(0);