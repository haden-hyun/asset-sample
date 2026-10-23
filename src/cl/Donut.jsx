/**
 * 도넛·이중 링 + 아래 범례.
 * rings = [{ segments: [{ key, label, value, color, onColor?, selectable? }], width? }] 안쪽 → 바깥. 바깥 조각은 안쪽 부모 순서대로.
 * center = { top, sub } 가운데 글자(구멍에 맞춰 크기를 줄인다).
 * legend = [{ key, label, value, pct, color, title?, selectable?, depth?(0 부모 굵게 · 1 들여쓰기) }]
 * hrefOf(key) 면 조각·범례가 링크, onSelect(key) 면 선택 버튼(selected = 선택 키).
 */
import { Link } from "react-router-dom";
import { share, krw } from "./format.js";
import "./donut.css";

const TAU = Math.PI * 2;
const pt = (r, a) => [r * Math.cos(a - Math.PI / 2), r * Math.sin(a - Math.PI / 2)];
function sector(r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  return `M${x0} ${y0}A${r1} ${r1} 0 ${large} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

export function Donut({ rings, center, legend, size = 200, label, onSelect, selected, hrefOf }) {
  const PAD = 14; // 바깥 비율 라벨 자리
  const R = size / 2 - PAD;
  const widths = rings.map((g) => g.width ?? (rings.length > 1 ? 0.2 : 0.44));
  const totalW = widths.reduce((a, w) => a + w, 0);
  const hole = R * (1 - totalW); // 가운데 구멍 반지름
  let r0 = hole;
  const layers = rings.map((g, i) => {
    const r1 = r0 + R * widths[i];
    const T = g.segments.reduce((a, s) => a + Math.max(0, s.value || 0), 0);
    let a = 0;
    const gap = 1.5 / r1; // 조각 사이 1.5px 면색 틈
    const segs = g.segments.map((s) => {
      const v = Math.max(0, s.value || 0), da = T ? (v / T) * TAU : 0;
      const a0 = a + (da > gap * 2 ? gap / 2 : 0), a1 = a + da - (da > gap * 2 ? gap / 2 : 0);
      a += da;
      const mid = (a0 + a1) / 2, rm = (r0 + r1) / 2;
      const pctTxt = share(v, T, 0);
      // 조각 안 비율: 글자 상자를 호·반지름 방향으로 투영해 호 길이·링 두께 안에 들 때만
      const tw = pctTxt.length * 7.6, th = 13, sn = Math.abs(Math.sin(mid)), cs = Math.abs(Math.cos(mid));
      const fits = tw * cs + th * sn + 6 <= (a1 - a0) * rm && tw * sn + th * cs + 4 <= r1 - r0;
      // 안에 못 넣으면 가장 바깥 링 밖에(0.5% 미만은 범례에만)
      const outer = !fits && i === rings.length - 1 && T > 0 && v / T >= 0.005;
      const [lx, ly] = fits ? pt(rm, mid) : pt(r1 + 6, mid);
      const anchor = fits ? "middle" : Math.sin(mid) >= 0.2 ? "start" : Math.sin(mid) <= -0.2 ? "end" : "middle";
      return { ...s, v, a0, a1, mid, tw, d: da > 0 ? sector(r0, r1, a0, a1) : null, lx, ly, pctTxt, fits, outer, anchor };
    });
    // 바깥 라벨이 겹치면 14px 바깥 줄로 엇갈리고, 그래도 겹치면 숨긴다
    const lane = [-Infinity, -Infinity]; // 두 줄 각각 마지막 라벨의 끝 각도
    segs.filter((s) => s.outer).forEach((s) => {
      for (const k of [0, 1]) {
        const r = r1 + 6 + k * 14, half = (s.tw / 2 + 2) / r;
        if (s.mid - half >= lane[k]) {
          lane[k] = s.mid + half;
          [s.lx, s.ly] = pt(r, s.mid);
          return;
        }
      }
      s.outer = false;
    });
    const out = { r0, r1, segs };
    r0 = r1;
    return out;
  });
  // 가운데 글자 크기: 구멍 지름 80% 안에 한 줄로(숫자 0.58em · 한글 1em 폭 어림)
  const fit = (txt, max) => {
    const w = [...String(txt || "")].reduce((a, c) => a + (/[가-힣]/.test(c) ? 1 : 0.58), 0) || 1;
    return Math.max(10, Math.min(max, (hole * 1.6) / w));
  };
  const topFs = fit(center?.top, size * 0.13), subFs = fit(center?.sub, 12);
  return (
    <div className="cl-donut">
      <svg className="cl-donut-svg" viewBox={`${-size / 2} ${-size / 2} ${size} ${size}`} width={size} height={size} role="img" aria-label={label}>
        {layers.map((l, i) => (
          <g key={i}>
            {l.segs.map((s) => {
              if (!s.d) return null;
              const act = s.selectable !== false && (onSelect || hrefOf);
              const path = (
                <path key={s.key} d={s.d} fill={s.color} className={act ? "cl-donut-seg cl-donut-click" : "cl-donut-seg"}
                  data-on={selected && selected === s.key ? "1" : undefined} onClick={act && onSelect ? () => onSelect(s.key) : undefined}>
                  <title>{`${s.label} ${krw(s.v)} · ${s.pctTxt}`}</title>
                </path>
              );
              // 조각 링크는 마우스용 — 키보드·낭독기는 범례 링크로
              return act && hrefOf ? <Link key={s.key} to={hrefOf(s.key)} tabIndex={-1} aria-hidden="true">{path}</Link> : path;
            })}
            {l.segs.map((s) => s.d && (s.fits || s.outer) && (
              <text key={`t${s.key}`} x={s.lx} y={s.ly} className={s.fits ? "cl-donut-pct" : "cl-donut-pct cl-donut-pct-out"} style={s.fits ? { fill: s.onColor || "#fff" } : { textAnchor: s.anchor }}>{s.pctTxt}</text>
            ))}
          </g>
        ))}
        {center?.top && <text className="cl-donut-c1" x="0" y={center.sub ? -topFs * 0.12 : topFs * 0.35} style={{ fontSize: topFs }}>{center.top}</text>}
        {center?.sub && <text className="cl-donut-c2" x="0" y={topFs * 0.62 + subFs * 0.5} style={{ fontSize: subFs }}>{center.sub}</text>}
      </svg>
      {legend?.length > 0 && (
        <ul className="cl-donut-leg">
          {legend.map((x) => {
            const body = <><i style={{ background: x.color }} /><span className="cl-donut-nm" title={x.title || x.label}>{x.label}</span><b className="cl-num">{krw(x.value)}</b><span className="cl-num cl-donut-p">{x.pct}</span></>;
            return (
              <li key={x.key} data-depth={x.depth}>
                {x.selectable === false ? <span className="cl-donut-row">{body}</span>
                  : hrefOf ? <Link className="cl-donut-row cl-donut-link" to={hrefOf(x.key)}>{body}</Link>
                  : onSelect ? <button type="button" className="cl-donut-row" aria-pressed={selected === undefined ? undefined : selected === x.key} onClick={() => onSelect(x.key)}>{body}</button>
                  : <span className="cl-donut-row">{body}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
