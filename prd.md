# Tài liệu Yêu cầu Sản phẩm (PRD) - Discord Music Bot

Tài liệu này xác định các yêu cầu kỹ thuật và chức năng cho bot phát nhạc Discord sử dụng Node.js, TypeScript và thư viện `discord.js`.

---

## 1. Mục tiêu Dự án (Project Goal)
Xây dựng một Discord Bot phát nhạc ổn định, chất lượng cao, hỗ trợ phát nhạc từ nhiều nền tảng (YouTube, SoundCloud, Spotify) thông qua đường dẫn (URL) hoặc tìm kiếm theo tên bài hát trên nền tảng tùy chọn. Bot hỗ trợ xếp hàng đợi (queue) phát nhạc theo thứ tự, chuyển bài, tạm dừng và thoát kênh thoại.

---

## 2. Các Tính năng Chính (Core Features)

### 2.1. Phát nhạc theo liên kết (URLs)
Tự động nhận diện và phân tích liên kết khi người dùng gửi đường dẫn:
- **YouTube**: Hỗ trợ video đơn lẻ hoặc toàn bộ danh sách phát (Playlist).
- **SoundCloud**: Hỗ trợ bài hát đơn lẻ (Tracks).
- **Spotify**: Hỗ trợ Track đơn lẻ, Album hoặc Playlist.
  - *Lưu ý kỹ thuật*: Do Spotify hạn chế stream trực tiếp, bot sẽ trích xuất metadata (tên bài, nghệ sĩ) từ link Spotify bằng thư viện cào trang web công khai (không cần đăng ký API Key), sau đó tìm kiếm và stream luồng âm thanh tương ứng từ YouTube.

### 2.2. Tìm kiếm theo tên & Chọn Nền tảng (Search by Name & Platform Selection)
Khi người dùng chỉ nhập tên bài hát (ví dụ: `Em Của Ngày Hôm Qua`):
- **Slash Commands (`/play`)**: Cho phép người dùng chọn nền tảng tìm kiếm thông qua tham số tùy chọn `platform` (`YouTube` hoặc `SoundCloud`). Mặc định là YouTube.
- **Prefix Commands (Tin nhắn văn bản thường, ví dụ: `!`)**:
  - `!play <tên bài>`: Tìm kiếm và phát từ YouTube.
  - `!playsc <tên bài>` hoặc `!play sc <tên bài>`: Tìm kiếm và phát từ SoundCloud.

### 2.3. Quản lý hàng đợi phát nhạc (Queue Management)
- Tự động phát các bài hát theo thứ tự từ trên xuống dưới.
- Cho phép thêm nhiều bài hát vào hàng đợi bất cứ lúc nào mà không làm gián đoạn bài hát đang phát.
- Hỗ trợ thêm hàng loạt bài hát khi phân tích playlist (YouTube/Spotify).

---

## 3. Hệ thống Lệnh (Bot Commands)

| Lệnh Slash | Lệnh Prefix | Tham số | Mô tả |
| :--- | :--- | :--- | :--- |
| `/play` | `!play` / `!playsc` | `query` (bắt buộc), `platform` (tùy chọn) | Tìm kiếm bài hát hoặc phát theo link và thêm vào hàng đợi. Tự động kết nối voice channel. |
| `/skip` | `!skip` / `!s` | Không | Bỏ qua bài hát đang phát để chuyển sang bài tiếp theo. |
| `/pause` | `!pause` | Không | Tạm dừng bài hát đang phát. |
| `/resume` | `!resume` | Không | Tiếp tục phát bài hát đang bị tạm dừng. |
| `/stop` | `!stop` / `!leave` | Không | Dừng nhạc, xóa toàn bộ hàng đợi và ngắt kết nối khỏi kênh thoại. |
| `/queue` | `!queue` / `!q` | Không | Hiển thị danh sách các bài hát trong hàng đợi. |
| `/nowplaying` | `/np` / `!np` | Không | Hiển thị thông tin chi tiết bài hát đang phát (Tiêu đề, thời lượng, ảnh bìa, người yêu cầu). |
| `/help` | `!help` / `!h` | Không | Hướng dẫn cách sử dụng bot và danh sách lệnh. |

---

## 4. Kiến trúc Kỹ thuật (Technical Architecture)

- **Môi trường chạy**: Node.js (v18 trở lên, khuyên dùng v20+ hoặc v24).
- **Ngôn ngữ**: TypeScript để kiểm soát kiểu dữ liệu và nâng cao chất lượng code.
- **Thư viện chính**:
  - `discord.js` (v14): Tương tác với Discord API và quản lý gateway events.
  - `@discordjs/voice`: Quản lý kết nối voice và luồng âm thanh.
  - `play-dl`: Tìm kiếm và lấy luồng âm thanh Opus trực tiếp từ YouTube / SoundCloud mà không cần tải file về ổ đĩa.
  - `spotify-url-info` và `isomorphic-unfetch`: Phân tích siêu dữ liệu từ link Spotify mà không cần thông tin đăng nhập (Client ID/Secret).
  - `ffmpeg-static`: Cung cấp file thực thi FFmpeg cho `@discordjs/voice`.
  - `libsodium-wrappers` & `opusscript`: Mã hóa luồng âm thanh tương thích với Windows/Linux mà không cần công cụ build C++.

---

## 5. Trải nghiệm người dùng (UX) & Thiết kế Thông báo

Các thông báo từ bot sẽ được gửi dưới dạng **Embed** đẹp mắt với:
- Ảnh đại diện của bài hát (Thumbnail).
- Thanh thời lượng (nếu có).
- Tên người yêu cầu phát nhạc (Requester).
- Màu sắc phân biệt trạng thái (ví dụ: Xanh lá khi thêm bài mới, Xanh dương khi đang phát, Đỏ khi dừng hoặc gặp lỗi).

---

## 6. Kế hoạch Phát triển Tương lai (Future Roadmap)
- Hỗ trợ phát lặp lại (Loop: lặp lại 1 bài hoặc lặp lại cả hàng đợi).
- Hỗ trợ phát ngẫu nhiên (Shuffle).
- Tích hợp lời bài hát (Lyrics).
- Quản lý âm lượng phát nhạc (Volume Control).
- Hỗ trợ thêm các nền tảng khác như Bandcamp, Facebook, Vimeo (nếu play-dl hỗ trợ).
