import { Component } from "react";

/** 렌더 예외를 이 영역에 가두고 오류 메시지(전달용 단서)와 다시 시도 버튼을 보인다. label = 영역 이름 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", this.props.label ?? "", error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="errorbox" role="alert">
        <strong>{this.props.label ? `${this.props.label} 표시 실패` : "이 영역 표시 실패"}</strong>
        <p>화면의 나머지는 정상입니다. 아래 내용을 알려주시면 원인을 찾을 수 있습니다.</p>
        <code>{String(error?.message || error).slice(0, 300)}</code>
        <button type="button" className="btn btn--quiet btn--sm" onClick={() => this.setState({ error: null })}>
          다시 시도
        </button>
      </div>
    );
  }
}
