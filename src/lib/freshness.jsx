import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDataHealth } from "./queries.js";

/**
 * 새 적재 감지 — /data-health 를 1분마다(탭이 보일 때만) 확인해 기준일·집계 시각이 바뀌면 다른 쿼리를 모두 무효화한다.
 * 반환 { spineStale: 집계가 원본보다 뒤처짐(값은 정확, 화면이 느릴 수 있음) }
 */
const POLL_MS = 60_000;

export function useFreshness() {
  const qc = useQueryClient();
  const seen = useRef(null);

  const q = useDataHealth({
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  const stamp = q.data ? `${q.data.as_of}|${q.data.spine?.refreshed_at ?? ""}|${q.data.loaded_at ?? ""}` : null;

  useEffect(() => {
    if (!stamp) return;
    if (seen.current === null) {
      seen.current = stamp; // 첫 로드는 갱신이 아님
      return;
    }
    if (seen.current !== stamp) {
      seen.current = stamp;
      // data-health 자신은 빼야 재요청 루프가 생기지 않는다
      qc.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "data-health",
      });
    }
  }, [stamp, qc]);

  return {
    spineStale: Boolean(q.data?.spine?.stale),
  };
}
