import { openDB } from 'idb';
// 引入所有需要管理的 Store
import { mainTrackClips, audioTrackClips, uploadedFiles } from '../stores/timelineStore';
import { get } from 'svelte/store';

const DB_NAME = 'CapCutCloneDB';
const STORE_NAME = 'projects';
const PROJECT_KEY = 'auto_save_v1';

// 初始化資料庫
async function initDB() {
    return openDB(DB_NAME, 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        },
    });
}

// 🔥 儲存專案 (Auto Save)
export async function saveProject() {
    const db = await initDB();
    
    const mainClips = get(mainTrackClips);
    const audioClips = get(audioTrackClips);
    const libraryFiles = get(uploadedFiles);

    const projectData = {
        main: mainClips,
        audio: audioClips,
        files: libraryFiles,
        lastModified: Date.now()
    };

    await db.put(STORE_NAME, projectData, PROJECT_KEY);
    console.log('Project Auto-saved @', new Date().toLocaleTimeString());
}

// 🔥 載入專案 (Auto Restore)
export async function loadProject() {
    const db = await initDB();
    const data = await db.get(STORE_NAME, PROJECT_KEY);

    if (!data) return false;

    // Helper: 重建 Blob URL
    const restoreAssets = (items) => {
        if (!items) return [];

        return items.map(item => {
            // 檢查是否有原始 file 物件
            if (item.file instanceof Blob || item.file instanceof File) {
                
                let restoredThumbnails = [];
                
                // 恢復縮圖陣列
                if (item.thumbnails && Array.isArray(item.thumbnails)) {
                    restoredThumbnails = item.thumbnails.map(blob => URL.createObjectURL(blob));
                }

                return {
                    ...item,
                    // 恢復主檔案 URL
                    fileUrl: item.fileUrl ? URL.createObjectURL(item.file) : undefined,
                    url: item.url ? URL.createObjectURL(item.file) : undefined,
                    
                    // 恢復縮圖 URL
                    thumbnailUrls: restoredThumbnails.length > 0 ? restoredThumbnails : (item.thumbnailUrls || [])
                };
            }
            return item;
        });
    };

    const restoredMain = restoreAssets(data.main || []);
    const restoredAudio = restoreAssets(data.audio || []);
    const restoredLibrary = restoreAssets(data.files || []);

    mainTrackClips.set(restoredMain);
    audioTrackClips.set(restoredAudio);
    uploadedFiles.set(restoredLibrary);
    
    return true;
}

// 🔥 清除專案 (New Project)
export async function clearProject() {
    const db = await initDB();
    // 1. 刪除資料庫紀錄
    await db.delete(STORE_NAME, PROJECT_KEY);
    
    // 2. 清空 Store (雖然 reload 會重置，但這是好習慣)
    mainTrackClips.set([]);
    audioTrackClips.set([]);
    uploadedFiles.set([]); 
}