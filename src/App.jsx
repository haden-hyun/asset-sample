import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./lib/auth.jsx";
import { Shell } from "./cl/Shell.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";
import Login from "./pages/Login.jsx";
import Home from "./cl/Home.jsx";
import Performance from "./cl/Performance.jsx";
import Holdings from "./cl/Holdings.jsx";
import Trades from "./cl/Trades.jsx";
import Allocation from "./cl/Allocation.jsx";
import { DividendPage } from "./cl/Dividend.jsx";
import Data from "./cl/Data.jsx";

/** 로그인 확인 후 셸 안에 화면을 그린다 */
function RequireAuth({ children }) {
  const { status } = useAuth();
  if (status === "checking") return null;
  if (status === "out") return <Navigate to="/login" replace />;
  return (
    <Shell>
      <ErrorBoundary label="이 화면">{children}</ErrorBoundary>
    </Shell>
  );
}

/** 옛 주소 → 새 주소. 쿼리·#은 유지하고 patch 만 덮어쓴다 */
function Moved({ to, patch = {} }) {
  const { search, hash } = useLocation();
  const n = new URLSearchParams(search);
  Object.entries(patch).forEach(([k, v]) => n.set(k, v));
  const q = n.toString();
  return <Navigate to={`${to}${q ? `?${q}` : ""}${hash}`} replace />;
}

const PAGES = [
  ["/", <Home />],
  ["/performance", <Performance />],
  ["/portfolio", <Holdings />],
  ["/trades", <Trades />],
  ["/allocation", <Allocation />],
  ["/dividend", <DividendPage />],
  ["/data", <Data />],
];

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {PAGES.map(([path, element]) => (
        <Route key={path} path={path} element={<RequireAuth>{element}</RequireAuth>} />
      ))}
      {/* 옛 북마크 */}
      <Route path="/timeseries" element={<Moved to="/performance" />} />
      <Route path="/ledger" element={<Moved to="/performance" patch={{ tab: "log" }} />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
