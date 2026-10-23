/* 로그인 상태 — status: "checking" | "in" | "out", login(id, password), logout() */
import { createContext, useContext, useEffect, useState } from "react";
import { api } from "./api.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    api
      .get("/auth/me")
      .then(() => setStatus("in"))
      .catch(() => setStatus("out"));
  }, []);

  async function login(id, password) {
    await api.post("/auth/login", { id, password });
    setStatus("in");
  }

  async function logout() {
    await api.post("/auth/logout", {});
    setStatus("out");
  }

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
