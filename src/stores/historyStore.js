// src/stores/historyStore.js
import { writable, get } from 'svelte/store';
import { mainTrackClips, audioTrackClips, textTrackClips, projectSettings } from './timelineStore';

// 歷史紀錄堆疊
const historyStack = writable({
    past: [],   // 過去的狀態 (Undo 用)
    future: []  // 未來的狀態 (Redo 用)
});

// 限制歷史紀錄步數 (避免無限膨脹)
const MAX_HISTORY = 50;

/**
 * 🔥 記錄當前狀態到歷史紀錄 (在進行破壞性操作前呼叫)
 */
export function addToHistory() {
    const currentState = {
        main: get(mainTrackClips),
        audio: get(audioTrackClips),
        text: get(textTrackClips),
        settings: get(projectSettings)
    };

    // 使用 structuredClone 進行深拷貝 (Deep Copy)
    // 這樣可以複製陣列結構，但 File/Blob 物件是複製參照(Reference)，不會爆記憶體
    const stateClone = structuredClone(currentState);

    historyStack.update(history => {
        const newPast = [...history.past, stateClone];
        if (newPast.length > MAX_HISTORY) newPast.shift(); // 超過限制就移除最舊的

        return {
            past: newPast,
            future: [] // 只要有新動作，未來的紀錄就失效了
        };
    });
}

/**
 * ⏪ 復原 (Undo)
 */
export function undo() {
    historyStack.update(history => {
        if (history.past.length === 0) return history;

        // 1. 儲存現在的狀態到 Future (為了可以 Redo)
        const currentState = {
            main: get(mainTrackClips),
            audio: get(audioTrackClips),
            text: get(textTrackClips),
            settings: get(projectSettings)
        };
        const futureState = structuredClone(currentState);

        // 2. 取出 Past 最後一個狀態
        const previousState = history.past[history.past.length - 1];
        const newPast = history.past.slice(0, -1);

        // 3. 應用狀態
        applyState(previousState);

        return {
            past: newPast,
            future: [futureState, ...history.future]
        };
    });
}

/**
 * ⏩ 重做 (Redo)
 */
export function redo() {
    historyStack.update(history => {
        if (history.future.length === 0) return history;

        // 1. 儲存現在的狀態到 Past (為了可以再次 Undo)
        const currentState = {
            main: get(mainTrackClips),
            audio: get(audioTrackClips),
            text: get(textTrackClips),
            settings: get(projectSettings)
        };
        const pastState = structuredClone(currentState);

        // 2. 取出 Future 第一個狀態
        const nextState = history.future[0];
        const newFuture = history.future.slice(1);

        // 3. 應用狀態
        applyState(nextState);

        return {
            past: [...history.past, pastState],
            future: newFuture
        };
    });
}

// Helper: 將狀態寫回 Store
function applyState(state) {
    if (!state) return;
    mainTrackClips.set(state.main);
    audioTrackClips.set(state.audio);
    textTrackClips.set(state.text);
    if (state.settings) projectSettings.set(state.settings);
}

export default historyStack;