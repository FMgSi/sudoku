/**
 * Cấu hình Firebase Realtime Database cho dự án UsDoku Clone.
 *
 * BƯỚC CÀI ĐẶT NHANH (chỉ mất ~2 phút, miễn phí hoàn toàn):
 * 1. Vào https://console.firebase.google.com/ -> Add project
 * 2. Vào Build -> Realtime Database -> Create Database (chọn Singapore hoặc gần nhất)
 * 3. Vào Project Settings (biểu tượng bánh răng) -> Your apps -> chọn Web (</>) -> Register app
 * 4. Copy object `firebaseConfig` và dán đè vào bên dưới!
 */
export const firebaseConfig = {
  apiKey: "AIzaSyAJBqZhZye_TjBNhwjSQ6kOolyJMex4Qi8",
  authDomain: "sudoku-5778c.firebaseapp.com",
  databaseURL: "https://sudoku-5778c-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "sudoku-5778c",
  storageBucket: "sudoku-5778c.firebasestorage.app",
  messagingSenderId: "444267173103",
  appId: "1:444267173103:web:3f3b290ff24f57d2a2771a"
};

export function isFirebaseConfigured(cfg = firebaseConfig) {
  return Boolean(
    cfg &&
      cfg.apiKey &&
      !cfg.apiKey.startsWith("PASTE_") &&
      cfg.databaseURL &&
      !cfg.databaseURL.includes("PASTE_")
  );
}
