# UsDoku Mini — Sudoku Multiplayer trên GitHub Pages

Web game Sudoku nhiều người chơi (3–4 bạn) chạy hoàn toàn tĩnh trên **GitHub Pages**, tối ưu cho điện thoại & mạng 4G thông qua **Firebase Realtime Database**, không cần backend server và không lưu lịch sử lâu dài.

## Tính năng chính

- **Tạo phòng & Phòng chờ:** Chọn độ khó 6 cấp (*Dễ / Trung bình / Khó / Chuyên gia / Bậc thầy / Cực khó*), sinh mã phòng 6 ký tự hoặc link mời (`?room=XXXXXX`). Chủ phòng bấm **Start Game** để cả nhóm bắt đầu cùng lúc.
- **Giải bảng riêng, đua tiến độ realtime:** Mỗi người giải trên bảng của riêng mình. Không gợi ý hay báo đúng/sai giữa chừng.
- **Kiểm tra khi đạt 100%:** Chỉ khi điền đủ 81/81 ô, chương trình mới kiểm tra tính hợp lệ. Nếu sai, hệ thống đánh dấu đỏ các ô trùng số để người chơi sửa lại; nếu đúng 100%, khóa bảng và chốt thứ hạng theo thời gian hoàn thành.
- **Standings + Mini-grid tô màu:** Hiển thị thứ hạng, phần trăm tiến độ và bảng thu nhỏ tô màu các ô từng người đã điền (giấu con số để tránh xem trộm).
- **Siêu nhẹ (~50 KB):** Viết bằng HTML5 + CSS3 + Vanilla JavaScript (ES Modules), không cần build step.

---

## Cách cài đặt Firebase miễn phí (~2 phút)

1. Truy cập [Firebase Console](https://console.firebase.google.com/) → bấm **Add project** (tạo dự án mới, có thể tắt Google Analytics cho nhanh).
2. Vào menu bên trái **Build → Realtime Database → Create Database**:
   - Chọn khu vực gần Việt Nam nhất (ví dụ **Singapore — `asia-southeast1`**).
   - Chọn **Start in test mode** để chạy thử nhanh.
3. (Khuyên dùng để không bị hết hạn 30 ngày của Test Mode) Vào tab **Rules** của Realtime Database và dán rule sau rồi bấm **Publish**:
   ```json
   {
     "rules": {
       "rooms": {
         "$roomId": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```
   *(Nếu muốn bảo mật chặt hơn nữa, vào **Build → Authentication → Sign-in method** bật **Anonymous**, rồi đổi `.read` và `.write` thành `"auth != null"` — code trong `src/realtime.js` đã hỗ trợ sẵn Anonymous Auth).*
4. Vào **Project Settings** (biểu tượng bánh răng ⚙️) → kéo xuống **Your apps** → chọn biểu tượng Web `</>` → đặt tên app bất kỳ → **Register app**.
5. Copy đoạn `firebaseConfig` và dán đè vào file `firebase-config.js`.

---

## Đưa lên GitHub Pages

1. Tạo một repository mới trên GitHub và đẩy toàn bộ nội dung thư mục `sudoku-multiplayer` lên nhánh `main`.
2. Trên GitHub repo, vào **Settings → Pages → Build and deployment**:
   - **Source:** `Deploy from a branch`
   - **Branch:** `main` / `/ (root)` → **Save**.
3. Đợi ~1 phút để GitHub cấp link `https://<ten-github>.github.io/<ten-repo>/`, gửi link đó cho bạn bè mở trên điện thoại 4G là chơi được ngay!

---

## Chạy thử trên máy tính

Vì project dùng ES Modules (`type="module"`), hãy mở qua một static HTTP server (không mở trực tiếp bằng `file://`):

```bash
python -m http.server 8080
```

Sau đó mở trình duyệt tại `http://localhost:8080` (có sẵn nút **Chơi thử Demo 3 người** để test ngay giao diện trước khi gắn Firebase).

Chạy unit test kiểm tra engine sinh đề & kiểm tra 100%:

```bash
node --test tests/sudoku.test.mjs
```
