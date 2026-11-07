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


type FacebookPage = { id: string; name: string; category?: string; connected?: boolean; is_default?: boolean; tasks?: string[] };
type FacebookAccount = { id: string; name: string };
const FACEBOOK_ACCOUNT_KEY = "reels-studio:facebook-account";
function readFacebookAccount(): FacebookAccount | null {
  if (typeof window === "undefined") return null;
  try { const value = localStorage.getItem(FACEBOOK_ACCOUNT_KEY); return value ? JSON.parse(value) as FacebookAccount : null; } catch { return null; }
}
type PublishJob = { id: number; video_id: number; page_name: string; page_id: string; scheduled_at: string; status: string; error_message?: string | null };


function PagesPanel() {
  const [account, setAccount] = useState<FacebookAccount | null>(null);
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const popup = useRef<Window | null>(null);

  const loadPages = useCallback(async (userId = account?.id) => {
    if (!userId) return;
    setLoading(true); setError("");
    try {
      const response = await fetch(API_URL + "/api/auth/facebook/pages?facebook_user_id=" + encodeURIComponent(userId), { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Không thể tải danh sách Fanpage.");
      setPages(body.pages || []);
    } catch (err) { setError(getErrorMessage(err)); }
    finally { setLoading(false); }
  }, [account?.id]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== new URL(API_URL).origin || event.source !== popup.current) return;
      if (event.data?.type !== "reels-studio:facebook-oauth") return;
      if (!event.data.success || !event.data.facebook_user?.id) {
        setError(event.data.error || "Không thể kết nối Facebook.");
        return;
      }
      const next = { id: String(event.data.facebook_user.id), name: String(event.data.facebook_user.name || "Facebook") };
      localStorage.setItem(FACEBOOK_ACCOUNT_KEY, JSON.stringify(next));
      setAccount(next);
      setNotice("Đã kết nối tài khoản " + next.name + ". Đang đồng bộ Fanpage...");
      void loadPages(next.id);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [loadPages]);

  useEffect(() => { setAccount(readFacebookAccount()); }, []);
  useEffect(() => { if (account?.id) void loadPages(account.id); }, [account?.id, loadPages]);

  function connect() {
    popup.current = window.open(API_URL + "/api/auth/facebook/login", "facebook-oauth", "popup,width=640,height=760");
    if (!popup.current) setError("Trình duyệt đã chặn popup. Hãy cho phép popup rồi thử lại.");
  }

  async function setDefault(page: FacebookPage) {
    if (!account) return;
    try {
      const response = await fetch(API_URL + "/api/auth/facebook/pages/" + encodeURIComponent(page.id) + "/default?facebook_user_id=" + encodeURIComponent(account.id), { method: "POST" });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể đặt Fanpage mặc định.");
      setNotice(body.message); await loadPages();
    } catch (err) { setError(getErrorMessage(err)); }
  }

  async function disconnectPage(page: FacebookPage) {
    if (!account || !window.confirm('Ngắt kết nối Fanpage "' + page.name + '"?')) return;
    try {
      const response = await fetch(API_URL + "/api/auth/facebook/pages/" + encodeURIComponent(page.id) + "?facebook_user_id=" + encodeURIComponent(account.id), { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể ngắt kết nối Fanpage.");
      setNotice(body.message); await loadPages();
    } catch (err) { setError(getErrorMessage(err)); }
  }

  async function disconnectAccount() {
    if (!account || !window.confirm("Ngắt kết nối tài khoản Facebook và xóa các phiên token đang lưu?")) return;
    try {
      const response = await fetch(API_URL + "/api/auth/facebook/connection?facebook_user_id=" + encodeURIComponent(account.id), { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể ngắt kết nối.");
      localStorage.removeItem(FACEBOOK_ACCOUNT_KEY); setAccount(null); setPages([]); setNotice(body.message);
    } catch (err) { setError(getErrorMessage(err)); }
  }

  return <section className="pages-page">
    <div className="page-heading"><div><div className="eyebrow">ACCOUNT CONNECTIONS</div><h1>Quản lý Fanpage</h1><p>Kết nối Facebook, đồng bộ trang bạn quản lý và chọn trang mặc định để đăng Reels.</p></div><button className="button button-primary" onClick={connect}>＋ Kết nối Facebook</button></div>
    {error && <div className="alert alert-error"><strong>Lỗi</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
    {notice && <div className="alert alert-success"><strong>Thông báo</strong><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div>}
    <section className="library-panel account-panel">
      <div className="account-heading"><div><span className={account ? "account-dot online" : "account-dot"}></span><div><strong>{account?.name || "Chưa kết nối tài khoản"}</strong><small>{account ? "Facebook User ID: " + account.id : "Kết nối Facebook để bắt đầu quản lý Fanpage."}</small></div></div><div className="account-actions"><button className="button button-secondary" onClick={() => void loadPages()} disabled={!account || loading}>↻ Đồng bộ</button>{account && <button className="button button-secondary" onClick={() => void disconnectAccount()}>Ngắt tài khoản</button>}</div></div>
      <div className="pages-list">
        {loading ? <div className="empty-state"><span className="spinner dark" /><strong>Đang đồng bộ Fanpage...</strong></div> :
          pages.length ? pages.map(page => <article className="page-card" key={page.id}>
            <div className="page-avatar">f</div><div className="page-info"><strong>{page.name}</strong><small>{page.category || "Fanpage"} · ID: {page.id}</small><div className="page-tags"><span>{page.connected ? "Đã cấp quyền" : "Thiếu Page Token"}</span>{page.is_default && <span className="default-tag">Mặc định</span>}</div></div>
            <div className="page-actions">{!page.is_default && <button className="text-action" onClick={() => void setDefault(page)}>Đặt mặc định</button>}<button className="text-action danger-text" onClick={() => void disconnectPage(page)}>Ngắt kết nối</button></div>
          </article>) : <div className="empty-state"><div className="empty-icon">▣</div><strong>{account ? "Chưa có Fanpage nào" : "Chưa kết nối Facebook"}</strong><p>{account ? "Đồng bộ lại hoặc kiểm tra quyền pages_show_list trong Meta App." : "Nhấn Kết nối Facebook để cấp quyền truy cập Fanpage."}</p><button className="button button-primary" onClick={account ? () => void loadPages() : connect}>{account ? "Đồng bộ Fanpage" : "Kết nối Facebook"}</button></div>}
      </div>
    </section>
  </section>;
}

function SchedulePanel() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [facebookUserId, setFacebookUserId] = useState("");
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [interval, setInterval] = useState(30);
  const [startAt, setStartAt] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [videoResponse, settingResponse, jobResponse] = await Promise.all([
        fetch(`${API_URL}/api/videos`, { cache: "no-store" }),
        fetch(`${API_URL}/api/publishing/settings`, { cache: "no-store" }),
        fetch(`${API_URL}/api/publishing/jobs`, { cache: "no-store" }),
      ]);
      if (!videoResponse.ok || !settingResponse.ok || !jobResponse.ok) throw new Error("Không thể tải dữ liệu lập lịch.");
      const [videoData, settingData, jobData] = await Promise.all([videoResponse.json(), settingResponse.json(), jobResponse.json()]);
      setVideos(videoData.videos || []); setInterval(settingData.interval_minutes || 30); setJobs(jobData.jobs || []);
    } catch (err) { setError(getErrorMessage(err)); } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const savedAccount = readFacebookAccount();
    if (savedAccount) setFacebookUserId(savedAccount.id);
    void loadData();
    const local = new Date(Date.now() + 5 * 60 * 1000);
    const localValue = new Date(local.getTime() - local.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    setStartAt(localValue);
  }, [loadData]);

  async function loadPages() {
    setError(""); setMessage("");
    if (!facebookUserId.trim()) { setError("Nhập Facebook User ID nhận được sau khi kết nối Facebook."); return; }
    try {
      const response = await fetch(`${API_URL}/api/auth/facebook/pages?facebook_user_id=${encodeURIComponent(facebookUserId.trim())}`);
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể tải Fanpage.");
      setPages(body.pages || []); const preferred = body.pages?.find((page: FacebookPage) => page.is_default) || body.pages?.[0]; setSelectedPageIds(preferred ? [preferred.id] : []);
      if (!body.pages?.length) setMessage("Tài khoản Facebook chưa có Fanpage được cấp quyền phù hợp.");
    } catch (err) { setError(getErrorMessage(err)); }
  }

  async function saveInterval() {
    setError(""); setMessage("");
    try {
      const response = await fetch(`${API_URL}/api/publishing/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ interval_minutes: interval }) });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể lưu khoảng cách đăng.");
      setMessage(`Đã lưu khoảng cách mặc định: ${body.interval_minutes} phút.`);
    } catch (err) { setError(getErrorMessage(err)); }
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setMessage("");
    const selectedPages = pages.filter(page => selectedPageIds.includes(page.id) && page.connected !== false);
    if (!facebookUserId.trim() || !selectedPages.length) { setError("Hãy kết nối Facebook và chọn ít nhất một Fanpage có quyền đăng."); return; }
    if (!selected.length) { setError("Hãy chọn ít nhất một video."); return; }
    try {
      let created = 0;
      const failures: string[] = [];
      for (const page of selectedPages) {
        try {
          const response = await fetch(`${API_URL}/api/publishing/schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facebook_user_id: facebookUserId.trim(), page_id: page.id, page_name: page.name, video_ids: selected, start_at: new Date(startAt).toISOString(), interval_minutes: interval }) });
          const body = await response.json();
          if (!response.ok) throw new Error(body.detail || "Không thể tạo lịch đăng.");
          created += body.jobs?.length || selected.length;
        } catch (err) {
          failures.push(page.name + ": " + getErrorMessage(err));
        }
      }
      if (created) {
        setMessage("Đã tạo " + created + " lịch đăng trên " + (selectedPages.length - failures.length) + "/" + selectedPages.length + " Fanpage.");
        setSelected([]);
        await loadData();
      }
      if (failures.length) setError("Một số Fanpage chưa tạo được lịch: " + failures.join(" · "));
      if (!created && !failures.length) setError("Không tạo được lịch đăng.");
    } catch (err) { setError(getErrorMessage(err)); }
  }

  async function cancelJob(id: number) {
    try {
      const response = await fetch(`${API_URL}/api/publishing/jobs/${id}`, { method: "DELETE" });
      const body = await response.json(); if (!response.ok) throw new Error(body.detail || "Không thể hủy lịch.");
      setMessage(body.message); await loadData();
    } catch (err) { setError(getErrorMessage(err)); }
  }

  const statusLabels: Record<string, string> = { pending: "Đang chờ", publishing: "Đang đăng", published: "Đã đăng", failed: "Thất bại", cancelled: "Đã hủy" };
  return <section className="schedule-page">
    <div className="page-heading"><div><div className="eyebrow">PUBLISHING AUTOMATION</div><h1>Lịch đăng Reels</h1><p>Chọn nhiều video, thiết lập thời gian bắt đầu và khoảng cách đăng tự động.</p></div><button className="button button-secondary" onClick={() => void loadData()}>↻ Làm mới</button></div>
    {error && <div className="alert alert-error"><strong>Lỗi</strong><span>{error}</span><button onClick={() => setError("")}>×</button></div>}
    {message && <div className="alert alert-success"><strong>Thông báo</strong><span>{message}</span><button onClick={() => setMessage("")}>×</button></div>}
    <div className="schedule-grid">
      <form className="library-panel schedule-form" onSubmit={createSchedule}>
        <div className="schedule-section-title"><div><h2>1. Kết nối Fanpage</h2><p>Token Fanpage được lưu tạm trong Redis, không hiển thị ra giao diện.</p></div></div>
        <div className="field-row"><label className="field-label">Tài khoản Facebook</label><div className="connected-account"><strong>{readFacebookAccount()?.name || (facebookUserId ? "Đã kết nối Facebook" : "Chưa kết nối")}</strong><small>{facebookUserId ? "ID: " + facebookUserId : "Kết nối và quản lý tài khoản tại mục Fanpage."}</small></div><button type="button" className="button button-secondary" onClick={() => void loadPages()} disabled={!facebookUserId}>↻ Đồng bộ Fanpage</button></div>
        <div className="field-row"><label className="field-label" htmlFor="page-select">Fanpage nhận video</label><select id="page-select" multiple value={selectedPageIds} onChange={e => setSelectedPageIds(Array.from(e.target.selectedOptions, option => option.value))}>{pages.map(page => <option key={page.id} value={page.id} disabled={page.connected === false}>{page.name}{page.is_default ? " · Mặc định" : ""}</option>)}</select><small className="field-hint">Giữ Ctrl (Windows) hoặc Command (Mac) để chọn nhiều Fanpage.</small></div>
        <div className="divider-line" />
        <div className="schedule-section-title"><div><h2>2. Chọn video đăng</h2><p>Thứ tự đăng theo thứ tự bạn chọn trong danh sách.</p></div><span className="selected-count">{selected.length} đã chọn</span></div>
        <div className="schedule-video-list">{videos.map(video => <label className="schedule-video" key={video.id}><input type="checkbox" checked={selected.includes(video.id)} onChange={e => setSelected(current => e.target.checked ? [...current, video.id] : current.filter(id => id !== video.id))} /><span className="video-thumb"><span>▶</span><small>VIDEO</small></span><span className="schedule-video-meta"><strong>{video.name}</strong><small>{formatBytes(video.size_bytes)} · {video.status === "ready" ? "Sẵn sàng" : video.status}</small></span></label>)}{!videos.length && <p className="muted-note">Chưa có video. Hãy tải video trong Thư viện video trước.</p>}</div>
        <div className="divider-line" />
        <div className="schedule-section-title"><div><h2>3. Cấu hình thời gian</h2><p>Khoảng cách được áp dụng giữa từng video trong đợt đăng này.</p></div></div>
        <div className="two-fields"><div className="field-row"><label className="field-label" htmlFor="start-at">Bắt đầu đăng lúc</label><input id="start-at" type="datetime-local" value={startAt} onChange={e => setStartAt(e.target.value)} required /></div><div className="field-row"><label className="field-label" htmlFor="interval">Khoảng cách (phút)</label><input id="interval" type="number" min="1" max="10080" value={interval} onChange={e => setInterval(Number(e.target.value))} required /></div></div>
        <button type="button" className="text-action save-interval" onClick={() => void saveInterval()}>Lưu làm khoảng cách mặc định</button>
        <div className="schedule-preview"><strong>Xem trước lịch</strong><span>{selected.length ? `${selected.length} video · ${interval} phút/video · dự kiến kết thúc sau ${Math.max(0, selected.length - 1) * interval} phút` : "Chọn video để xem trước lịch đăng."}</span></div>
        <button type="submit" className="button button-primary schedule-submit" disabled={!selected.length || !startAt}>＋ Tạo lịch đăng Reels</button>
      </form>
      <aside className="library-panel schedule-help"><div className="schedule-section-title"><div><h2>Khoảng cách đăng</h2><p>Thiết lập nhanh cho các đợt đăng tiếp theo.</p></div></div><div className="interval-presets">{[15,30,60,120,360].map(value => <button key={value} type="button" className={interval === value ? "interval-chip chosen" : "interval-chip"} onClick={() => setInterval(value)}>{value < 60 ? `${value} phút` : `${value / 60} giờ`}</button>)}</div><div className="schedule-note"><strong>Lưu ý vận hành</strong><p>Worker kiểm tra lịch đến hạn mỗi 30 giây. Máy chủ cần chạy Redis, Celery Worker và Celery Beat. Nếu token Fanpage hết hạn, lịch chuyển sang trạng thái thất bại và hiển thị lý do.</p></div></aside>
    </div>
    <section className="library-panel jobs-panel"><div className="panel-heading"><div><h2>Lịch đã tạo <span>{jobs.length}</span></h2><p>Theo dõi trạng thái đăng Reels</p></div></div><div className="jobs-list">{jobs.length ? jobs.map(job => <article className="job-row" key={job.id}><div><strong>Video #{job.video_id}</strong><small>{job.page_name || job.page_id} · {formatDate(job.scheduled_at)}</small>{job.error_message && <small className="job-error">{job.error_message}</small>}</div><span className={`job-status status-${job.status}`}>{statusLabels[job.status] || job.status}</span>{job.status === "pending" && <button className="text-action" onClick={() => void cancelJob(job.id)}>Hủy lịch</button>}</article>) : <div className="empty-state"><strong>Chưa có lịch đăng</strong><p>Lịch bạn tạo sẽ xuất hiện ở đây.</p></div>}</div></section>
  </section>;
}


function HistoryPanel() {
  const [jobs, setJobs] = useState<PublishJob[]>([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHistory = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const query = filter === "all" ? "" : `?status=${encodeURIComponent(filter)}`;
      const response = await fetch(`${API_URL}/api/publishing/jobs${query}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.detail || "Không thể tải lịch sử đăng.");
      setJobs(body.jobs || []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const counts = {
    published: jobs.filter(job => job.status === "published").length,
    failed: jobs.filter(job => job.status === "failed").length,
    pending: jobs.filter(job => job.status === "pending" || job.status === "publishing").length,
  };
  const labels: Record<string, string> = {
    pending: "Đang chờ", publishing: "Đang đăng", published: "Thành công",
    failed: "Thất bại", cancelled: "Đã hủy",
  };

  return <section className="history-page">
    <div className="page-heading">
      <div><div className="eyebrow">PUBLISHING REPORT</div><h1>Lịch sử đăng</h1><p>Theo dõi các video đã đăng, đang chờ và những lần đăng gặp lỗi.</p></div>
      <button className="button button-secondary" onClick={() => void loadHistory()} disabled={loading}>↻ Làm mới</button>
    </div>
    {error && <div className="alert alert-error"><strong>Lỗi</strong><span>{error}</span></div>}
    <div className="history-stats">
      <article className="history-stat"><span>Đã đăng thành công</span><strong>{counts.published}</strong></article>
      <article className="history-stat"><span>Đang chờ / xử lý</span><strong>{counts.pending}</strong></article>
      <article className="history-stat"><span>Đăng thất bại</span><strong>{counts.failed}</strong></article>
    </div>
    <section className="library-panel jobs-panel">
      <div className="panel-heading">
        <div><h2>Danh sách lần đăng</h2><p>{jobs.length} kết quả {filter !== "all" ? `· bộ lọc: ${labels[filter]}` : ""}</p></div>
        <select aria-label="Lọc trạng thái lịch đăng" value={filter} onChange={event => setFilter(event.target.value)}>
          <option value="all">Tất cả trạng thái</option>
          <option value="pending">Đang chờ</option>
          <option value="publishing">Đang đăng</option>
          <option value="published">Đã đăng</option>
          <option value="failed">Thất bại</option>
          <option value="cancelled">Đã hủy</option>
        </select>
      </div>
      <div className="jobs-list">
        {loading ? <div className="empty-state"><p>Đang tải lịch sử...</p></div> :
          jobs.length ? jobs.map(job => <article className="job-row" key={job.id}>
            <div><strong>Video #{job.video_id}</strong><small>{job.page_name || job.page_id} · {formatDate(job.scheduled_at)}</small>{job.error_message && <small className="job-error">{job.error_message}</small>}</div>
            <span className={`job-status status-${job.status}`}>{labels[job.status] || job.status}</span>
          </article>) :
          <div className="empty-state"><strong>Chưa có dữ liệu</strong><p>Các lần đăng sẽ xuất hiện tại đây sau khi bạn tạo lịch.</p></div>}
      </div>
    </section>
  </section>;
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
          <button className={activeNav === "pages" ? "nav-item active" : "nav-item"} onClick={() => setActiveNav("pages")}><span>▣</span>Fanpage</button>
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
          {activeNav === "schedule" ? <SchedulePanel /> : activeNav === "history" ? <HistoryPanel /> : activeNav === "pages" ? <PagesPanel /> : activeNav === "library" ? <>
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
