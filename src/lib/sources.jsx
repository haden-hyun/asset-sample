import { useDataHealth } from "./queries.js";

/**
 * 원천 적재 여부 — /data-health 의 sources 에서. 반환 { loading, dividend: 배당 기록 있음, price: 1년 종가 있음 }
 * sources 가 없으면 둘 다 false.
 */
export function useSources() {
  const q = useDataHealth();
  const s = q.data?.sources || {};
  return {
    loading: q.isLoading,
    dividend: !!s.dividend?.available,
    price: !!s.price?.available,
  };
}
