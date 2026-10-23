import { Component, type ReactNode } from 'react';
import { Alert, Button } from 'antd';
export default class KnowledgeSectionBoundary extends Component<{ children: ReactNode; onBack: () => void }, { failed: boolean }> {
    state = { failed: false };
    static getDerivedStateFromError() { return { failed: true }; }
    render() { return this.state.failed ? <div className="knowledge-empty"><Alert type="error" title="此区域暂时无法显示，原文与本机草稿保留" /><Button onClick={() => this.setState({ failed: false })}>重试此区域</Button><Button onClick={this.props.onBack}>返回知识库</Button></div> : this.props.children; }
}
