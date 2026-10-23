import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth.jsx";

/** 로그인 화면 — 로그인돼 있으면 홈으로 */
export default function Login() {
  const { status, login } = useAuth();
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  if (status === "in") return <Navigate to="/" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(id, password);
    } catch (err) {
      setError(err.message || "로그인에 실패했습니다");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="mark" />
        <h1>내 자산</h1>
        <div className="field">
          <label htmlFor="id">아이디</label>
          <input id="id" type="text" value={id} onChange={(e) => setId(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor="password">비밀번호</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        <button className="btn" type="submit" disabled={busy} style={{ width: "100%" }}>
          {busy ? "확인 중..." : "로그인"}
        </button>
        {error && <p className="error-text">{error}</p>}
      </form>
    </div>
  );
}
