import { openDB } from 'idb';
// 引入所有需要存檔的 Store
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
        // 如果 items 是 undefined 或 null，回傳空陣列
        if (!items) return [];

        return items.map(item => {
            // 檢查是否有原始 file 物件 (File 或 Blob)
            if (item.file instanceof Blob || item.file instanceof File) {
                
                // 🔥 修正點：先宣告變數，確保它存在
                let restoredThumbnails = [];
                
                // 檢查並恢復縮圖陣列
                if (item.thumbnails && Array.isArray(item.thumbnails)) {
                    restoredThumbnails = item.thumbnails.map(blob => URL.createObjectURL(blob));
                }

                return {
                    ...item,
                    // 恢復主檔案 URL
                    fileUrl: item.fileUrl ? URL.createObjectURL(item.file) : undefined, // Clip 用
                    url: item.url ? URL.createObjectURL(item.file) : undefined,         // FileUploader 用
                    
                    // 🔥 恢復縮圖 URL 陣列
                    thumbnailUrls: restoredThumbnails
                };
            }
            return item;
        });
    };

    // 依序恢復三個 Store 的資料
    const restoredMain = restoreAssets(data.main || []);
    const restoredAudio = restoreAssets(data.audio || []);
    const restoredLibrary = restoreAssets(data.files || []);

    // 寫回 Store
    mainTrackClips.set(restoredMain);
    audioTrackClips.set(restoredAudio);
    uploadedFiles.set(restoredLibrary);
    
    return true;
}

// 清除專案
export async function clearProject() {
    const db = await initDB();
    await db.delete(STORE_NAME, PROJECT_KEY);
    mainTrackClips.set([]);
    audioTrackClips.set([]);
    uploadedFiles.set([]);
}