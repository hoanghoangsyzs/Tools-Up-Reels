"use client";

import { ChangeEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type VideoItem = {
  id: number;
  name: string;
  size_bytes: number;
  caption: string;
  status: string;
  created_at: string;
  download_url: string;
};

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/$/, "");

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định.";
}

export default function Home() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingCaption, setEditingCaption] = useState("");
  const [activeNav, setActiveNav] = useState("library");
  const [apiOnline, setApiOnline] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadVideos = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`${API_URL}/api/videos`, { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail || `Không thể tải thư viện video (HTTP ${response.status}).`);
      }
      const data = await response.json();
      setVideos(data.videos || []);
      setApiOnline(true);
    } catch (err) {
      setApiOnline(false);
      setError(`${getErrorMessage(err)} Kiểm tra Backend, PostgreSQL và cấu hình NEXT_PUBLIC_API_URL.`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadVideos(); }, [loadVideos]);

  const filteredVideos = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("vi");
    if (!value) return videos;
    return videos.filter((video) => video.name.toLocaleLowerCase("vi").includes(value) || video.caption.toLocaleLowerCase("vi").includes(value));
  }, [query, videos]);

  const totalSize = videos.reduce((sum, video) => sum + video.size_bytes, 0);

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploading(true);
    setError("");
    setNotice("");
    let succeeded = 0;
    const failures: string[] = [];
    for (const file of files) {
      const form = new FormData();
      form.append("file", file);
      try {
        const response = await fetch(`${API_URL}/api/videos`, { method: "POST", body: form });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.detail || `HTTP ${response.status}`);
        succeeded += 1;
      } catch (err) {
        failures.push(`${file.name}: ${getErrorMessage(err)}`);
      }
    }
    setUploading(false);
    event.target.value = "";
    if (succeeded) setNotice(`Đã tải lên ${succeeded} video.`);
    if (failures.length) setError(failures.join(" • "));
    await loadVideos();
  }

  async function saveCaption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (editingId === null) return;
    try {
      const response = await fetch(`${API_URL}/api/videos/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: editingCaption }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || "Không thể cập nhật caption.");
      setNotice("Đã cập nhật caption.");
      setEditingId(null);
      await loadVideos();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  async function removeVideo(video: VideoItem) {
    if (!window.confirm(`Bạn chắc chắn muốn xóa video “${video.name}”? Thao tác này không thể hoàn tác.`)) return;
    try {
      const response = await fetch(`${API_URL}/api/videos/${video.id}`, { method: "DELETE" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail || "Không thể xóa video.");
      setNotice(`Đã xóa ${video.name}.`);
      await loadVideos();
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Reels Studio trang chủ">
          <span className="brand-mark">R</span>
          <span>reels<span className="brand-light">studio</span><small>CREATOR WORKSPACE</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Điều hướng chính">
          <button className={activeNav === "overview" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("overview")}><span>◫</span>Tổng quan</button>
          <button className={activeNav === "library" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("library")}><span>▤</span>Thư viện video</button>
          <button className={activeNav === "pages" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("pages")}><span>▣</span>Fanpage <em>0</em></button>
          <button className={activeNav === "schedule" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("schedule")}><span>◷</span>Lịch đăng</button>
          <button className={activeNav === "history" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("history")}><span>↗</span>Lịch sử đăng</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="plan-card"><div className="plan-icon">✦</div><strong>Creator workspace</strong><p>Quản lý nội dung Reels tại một nơi.</p><span>GÓI PHÁT TRIỂN</span></div>
          <div className="profile-row"><div className="avatar">H</div><div><strong>Hoàng</strong><small>Quản trị viên</small></div><span className="profile-more">•••</span></div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">Workspace <span>/</span> <strong>{activeNav === "library" ? "Thư viện video" : activeNav === "overview" ? "Tổng quan" : activeNav === "pages" ? "Fanpage" : activeNav === "schedule" ? "Lịch đăng" : "Lịch sử đăng"}</strong></div>
          <div className="topbar-actions"><span className={apiOnline ? "connection online" : "connection"}><i />{apiOnline ? "Backend đang hoạt động" : "Chưa kết nối Backend"}</span><button className="icon-button" title="Làm mới dữ liệu" onClick={() => void loadVideos()}>↻</button><div className="avatar small">H</div></div>
        </header>

        <div className="content">
          {activeNav === "library" ? <>
            <div className="page-heading">
              <div><div className="eyebrow">CONTENT MANAGEMENT</div><h1>Thư viện video</h1><p>Quản lý, chuẩn bị và tổ chức video trước khi đăng Reels.</p></div>
              <div className="heading-actions"><button className="button button-secondary" onClick={() => void loadVideos()}>↻ <span>Làm mới</span></button><button className="button button-primary" onClick={() => fileInput.current?.click()} disabled={uploading}>{uploading ? <><span className="spinner" /> Đang tải...</> : <><span>＋</span> Tải video lên</>}</button><input ref={fileInput} type="file" accept="video/mp4,video/quicktime,.m4v" multiple hidden onChange={uploadFiles} /></div>
            </div>

            {error && <div className="alert alert-error"><strong>Không thể thực hiện</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
            {notice && <div className="alert alert-success"><strong>Thành công</strong><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}

            <div className="stats-grid">
              <article className="stat-card"><div className="stat-top"><span>TỔNG VIDEO</span><span className="stat-icon purple">▤</span></div><strong>{videos.length}</strong><small>Video trong thư viện</small></article>
              <article className="stat-card"><div className="stat-top"><span>DUNG LƯỢNG</span><span className="stat-icon blue">▧</span></div><strong>{formatBytes(totalSize)}</strong><small>Tổng dung lượng lưu trữ</small></article>
              <article className="stat-card"><div className="stat-top"><span>SẴN SÀNG</span><span className="stat-icon green">✓</span></div><strong>{videos.filter(v => v.status === "ready").length}</strong><small>Video sẵn sàng xử lý</small></article>
              <article className="stat-card"><div className="stat-top"><span>ĐANG CHỜ ĐĂNG</span><span className="stat-icon orange">◷</span></div><strong>0</strong><small>Chưa có lịch đăng</small></article>
            </div>

            <section className="library-panel">
              <div className="panel-heading"><div><h2>Tất cả video <span>{videos.length}</span></h2><p>Danh sách video đã tải lên hệ thống</p></div><label className="search-box"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm tên video, caption..." /><kbd>⌘ K</kbd></label></div>
              {loading ? <div className="empty-state"><span className="spinner dark" /><strong>Đang tải thư viện...</strong><p>Đang đồng bộ dữ liệu từ máy chủ.</p></div> : filteredVideos.length === 0 ? <div className="empty-state"><div className="empty-icon">▤</div><strong>{query ? "Không tìm thấy video" : "Thư viện của bạn đang trống"}</strong><p>{query ? "Thử tìm kiếm với từ khóa khác." : "Tải video đầu tiên lên để bắt đầu xây dựng lịch đăng Reels."}</p>{!query && <button className="button button-primary" onClick={() => fileInput.current?.click()}>＋ Tải video đầu tiên</button>}</div> : <div className="video-list">
                <div className="video-list-head"><span>TÊN VIDEO</span><span>DUNG LƯỢNG</span><span>TRẠNG THÁI</span><span>NGÀY TẢI</span><span /></div>
                {filteredVideos.map(video => <article className="video-row" key={video.id}>
                  <div className="video-info"><div className="video-thumb"><span>▶</span><small>VIDEO</small></div><div className="video-meta"><strong title={video.name}>{video.name}</strong><small>{video.caption || "Chưa có caption"}</small></div></div>
                  <span className="video-size">{formatBytes(video.size_bytes)}</span>
                  <span><i className="status-dot" /> <span className="status-text">{video.status === "ready" ? "Sẵn sàng" : video.status}</span></span>
                  <span className="video-date">{formatDate(video.created_at)}</span>
                  <div className="row-actions"><a href={`${API_URL}${video.download_url}`} target="_blank" rel="noreferrer" title="Xem hoặc tải video">↗</a><button title="Sửa caption" onClick={() => { setEditingId(video.id); setEditingCaption(video.caption || ""); }}>✎</button><button className="danger-action" title="Xóa video" onClick={() => void removeVideo(video)}>⌫</button></div>
                </article>)}
              </div>}
              <div className="panel-footer"><span>Hiển thị {filteredVideos.length} / {videos.length} video</span><span>Giới hạn mỗi video: 500 MB · MP4, MOV, M4V</span></div>
            </section>
          </> : <section className="coming-soon"><div className="coming-icon">{activeNav === "pages" ? "▣" : activeNav === "schedule" ? "◷" : activeNav === "history" ? "↗" : "◫"}</div><div className="eyebrow">ĐANG PHÁT TRIỂN</div><h1>{activeNav === "overview" ? "Tổng quan hệ thống" : activeNav === "pages" ? "Quản lý Fanpage" : activeNav === "schedule" ? "Lịch đăng Reels" : "Lịch sử đăng"}</h1><p>Khu vực này sẽ được kết nối với API tiếp theo. Hiện tại bạn có thể quản lý video trong thư viện.</p><button className="button button-primary" onClick={() => setActiveNav("library")}>Mở thư viện video</button></section>}
          <footer className="footer"><span>© 2026 Reels Studio</span><span>Built for creators <b>✦</b></span></footer>
        </div>
      </section>

      {editingId !== null && <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setEditingId(null); }}><form className="edit-modal" onSubmit={saveCaption}><div className="modal-head"><div><div className="eyebrow">VIDEO DETAILS</div><h2>Chỉnh sửa caption</h2></div><button type="button" className="icon-button" onClick={() => setEditingId(null)}>×</button></div><label className="field-label" htmlFor="caption">Nội dung caption</label><textarea id="caption" rows={6} maxLength={5000} value={editingCaption} onChange={e => setEditingCaption(e.target.value)} placeholder="Nhập caption cho video..." /><div className="character-count">{editingCaption.length}/5000 ký tự</div><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEditingId(null)}>Hủy</button><button type="submit" className="button button-primary">Lưu thay đổi</button></div></form></div>}
    </main>
  );
}
