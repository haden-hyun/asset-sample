/* 두 화면 이상이 같은 키로 부르는 react-query 쿼리 — 키·URL을 한 곳에 둬 캐시를 나눠 쓴다. opts = useQuery 옵션(enabled 등) */
import { useQueries, useQuery } from "@tanstack/react-query";
import { api } from "./api.js";

/** /overview/accounts → 계좌 목록 */
export const useAccounts = (opts) => useQuery({ queryKey: ["accounts"], queryFn: () => api.get("/overview/accounts"), ...opts });

/** /positions?view= → 보유 행. view "account_product" | "product"(scope = scope_code, 없으면 전체) */
export const usePositions = (view, scope = null, opts) => useQuery({
  queryKey: view === "product" ? ["positions", "product", scope || "all"] : scope ? ["positions", view, scope] : ["positions", view],
  queryFn: () => api.get(`/positions?view=${view}${scope ? `&scope_code=${scope}` : ""}`),
  ...opts,
});

/** /risk/xray → 쏠림 점검 규칙 */
export const useXray = () => useQuery({ queryKey: ["xray"], queryFn: () => api.get("/risk/xray") });

/** /goals → 연간 납입 목표 */
export const useGoals = () => useQuery({ queryKey: ["goals"], queryFn: () => api.get("/goals") });

/** /allocation/scopes + 묶음마다 /allocation/{code} → { scopes, details(useQueries 결과 배열) } */
export function useAllocations() {
  const scopes = useQuery({ queryKey: ["alloc-scopes"], queryFn: () => api.get("/allocation/scopes") });
  const details = useQueries({
    queries: (scopes.data || []).map((s) => ({ queryKey: ["alloc", s.scope_code], queryFn: () => api.get(`/allocation/${s.scope_code}`) })),
  });
  return { scopes, details };
}

/** /dividends?scope_code=&tax= → 배당 요약 */
export const useDividends = (scope, tax, opts) => useQuery({
  queryKey: ["dividends", scope, tax],
  queryFn: () => api.get(`/dividends?scope_code=${scope}&tax=${tax}`),
  ...opts,
});

/** /manual-entry → 수기 계좌(최신 원장)·최근 입력 기록 — 데이터 화면·신뢰 상세가 같이 쓴다 */
export const useManualEntry = (opts) => useQuery({ queryKey: ["manual-entry"], queryFn: () => api.get("/manual-entry"), ...opts });

/** /data-health → 적재 상태 */
export const useDataHealth = (opts) => useQuery({ queryKey: ["data-health"], queryFn: () => api.get("/data-health"), ...opts });

/** /lineage/graph → 흐름 그래프(노드·간선·상태) — 데이터 › 흐름·신뢰 상세가 같이 쓴다 */
export const useLineage = (opts) => useQuery({ queryKey: ["lineage", "graph"], queryFn: () => api.get("/lineage/graph"), ...opts });

/** /lineage/nodes/{id} → 노드 상세(이전·이후 단계 · 영향 화면 · 실행 이력). id 가 없으면 부르지 않는다 */
export const useLineageNode = (id, opts) => useQuery({
  queryKey: ["lineage", "node", id],
  queryFn: () => api.get(`/lineage/nodes/${encodeURIComponent(id)}`),
  enabled: !!id,
  ...opts,
});
