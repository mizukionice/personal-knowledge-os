import { Fragment, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, SendHorizonal } from 'lucide-react';

import { chatApi, type ChatCitation } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
  citations?: ChatCitation[];
  usedGeneralKnowledge?: boolean;
}

/** 回答文中の `[書名 p.N §sec]` をViewerへのリンクに変換する */
const CITATION_PATTERN = /\[([^[\]]+?)\s+p\.(\d+)(?:\s+§([^[\]]+?))?\]/g;

function renderAnswer(content: string, citations: ChatCitation[] = []): ReactNode[] {
  const byTitle = new Map<string, string>();
  for (const citation of citations) {
    if (citation.document_id) byTitle.set(citation.title, citation.document_id);
  }

  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let key = 0;
  for (const match of content.matchAll(CITATION_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      nodes.push(<Fragment key={key++}>{content.slice(lastIndex, index)}</Fragment>);
    }
    const title = match[1]!.trim();
    const documentId = byTitle.get(title);
    if (documentId) {
      nodes.push(
        <Link
          key={key++}
          to={`/documents/${documentId}`}
          className="mx-0.5 rounded bg-primary/10 px-1 py-0.5 text-xs font-medium text-primary hover:underline"
        >
          {match[0]}
        </Link>,
      );
    } else {
      nodes.push(<Fragment key={key++}>{match[0]}</Fragment>);
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < content.length) {
    nodes.push(<Fragment key={key++}>{content.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function ChatPage() {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const message = input.trim();
    if (message === '' || isBusy) return;

    // 履歴は直近の完成ターンのみ（ストリーミング中の断片は含めない）
    const history = turns.slice(-20).map(({ role, content }) => ({ role, content }));
    setTurns((prev) => [...prev, { role: 'user', content: message }]);
    setInput('');
    setErrorMessage(null);
    setIsBusy(true);
    setStreamingText('');

    let answer = '';
    try {
      const result = await chatApi.stream(message, history, (text) => {
        answer += text;
        setStreamingText(answer);
        bottomRef.current?.scrollIntoView?.({ block: 'end' });
      });
      setTurns((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: answer,
          citations: result.citations,
          usedGeneralKnowledge: result.used_general_knowledge,
        },
      ]);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : '回答の取得に失敗しました');
    } finally {
      setStreamingText(null);
      setIsBusy(false);
    }
  };

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <h1 className="text-2xl font-semibold">Chat</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        蔵書を根拠に、出典ページ付きで回答します。引用をクリックすると本文へ移動できます。
      </p>

      <div className="mt-6 flex-1 space-y-4">
        {turns.length === 0 && streamingText === null && (
          <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            例: 「犍陀多はなぜ蜘蛛の糸を垂らしてもらえた？」「TCPとUDPの違いは？」
          </p>
        )}

        {turns.map((turn, index) =>
          turn.role === 'user' ? (
            <div key={index} className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
                {turn.content}
              </div>
            </div>
          ) : (
            <div key={index} className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm border bg-card px-4 py-3 text-sm shadow-sm">
                {turn.usedGeneralKnowledge && (
                  <span className="mb-2 inline-block rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                    ライブラリ外の一般知識
                  </span>
                )}
                <div className="whitespace-pre-wrap leading-relaxed">
                  {renderAnswer(turn.content, turn.citations)}
                </div>
              </div>
            </div>
          ),
        )}

        {streamingText !== null && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-sm border bg-card px-4 py-3 text-sm shadow-sm">
              <div className="whitespace-pre-wrap leading-relaxed">
                {streamingText === '' ? (
                  <span className="inline-flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    蔵書を検索しています…
                  </span>
                ) : (
                  streamingText
                )}
              </div>
            </div>
          </div>
        )}

        {errorMessage && (
          <p role="alert" className="text-sm text-destructive">
            {errorMessage}
          </p>
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="sticky bottom-0 mt-6 flex gap-2 bg-background pb-4">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="蔵書について質問する"
          aria-label="質問"
          disabled={isBusy}
        />
        <Button type="submit" disabled={input.trim() === '' || isBusy}>
          {isBusy ? <Loader2 className="animate-spin" /> : <SendHorizonal />}
          送信
        </Button>
      </form>
    </div>
  );
}
