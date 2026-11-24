import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  ChevronLeft,
  FileText,
  Image as ImageIcon,
  MessageSquare,
  Paperclip,
  Pencil,
  Pin,
  PinOff,
  Trash2,
  X,
} from "lucide-react";
import { api } from "../api";
import {
  prepareUpload,
  sendMessage,
  type ChatCard,
  type ChatMessage,
  type ChatSummary,
  type Upload,
} from "../chat/api";
import { Markdown } from "../chat/Markdown";
import { ICON } from "../components/icons";
import { Shake, SwapIcon, Tooltip } from "../components/motion";
import { Button, Input, Notice } from "../components/ui";
import { navigate } from "../navigation";

// Chat with the bot's assistant, like Telegram, with saved chats.

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong.";
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString("en-SG", { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString("en-SG", { day: "numeric", month: "short" });
}

const CARD_BUTTONS: Record<ChatCard["type"], [string, string | null]> = {
  delete: ["Delete", "Keep"],
  "calendar-delete": ["Delete", "Keep"],
  "calendar-create": ["Create", "Cancel"],
  undo: ["Undo", null],
};

function Cards({
  chatId,
  message,
  onChange,
}: {
  chatId: number;
  message: ChatMessage;
  onChange: (cards: ChatCard[]) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const press = async (index: number, action: "confirm" | "cancel") => {
    setBusy(index);
    setError(null);
    try {
      const { card } = await api<{ card: ChatCard }>(
        `chats/${chatId}/messages/${message.id}/cards/${index}`,
        { method: "POST", body: { action } },
      );
      onChange(message.cards.map((c, i) => (i === index ? card : c)));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-3 space-y-2">
      {message.cards.map((card, index) => {
        const [confirm, cancel] = CARD_BUTTONS[card.type];
        const open = card.state === "pending" || card.state === "failed";
        return (
          <div
            key={index}
            // Inner radius 8 px = reply's 20 px − its 12 px padding.
            className="rounded-[8px] border border-line bg-sunken px-3 py-2 text-sm"
          >
            <p className="break-words">{card.label}</p>
            {card.result && (
              <p
                className={`mt-1 text-xs ${card.state === "failed" ? "text-danger" : "text-muted"}`}
              >
                {card.result}
              </p>
            )}
            {open && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant={card.type === "undo" ? "secondary" : "primary"}
                  disabled={busy !== null}
                  onClick={() => void press(index, "confirm")}
                >
                  {card.state === "failed" ? "Try again" : confirm}
                </Button>
                {cancel && (
                  <Button
                    variant="ghost"
                    disabled={busy !== null}
                    onClick={() => void press(index, "cancel")}
                  >
                    {cancel}
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}

// Your messages are tinted, not solid accent: the accent is kept for the
// 10% (buttons, links, the active item), never large areas.
const USER_BUBBLE =
  "max-w-[85%] whitespace-pre-wrap break-words rounded-[20px] rounded-br-md bg-accent-soft px-4 py-2.5 text-sm text-ink";
// 20 px corners with 12 px padding, so the cards inside get 8 px.
const REPLY_BUBBLE =
  "max-w-[92%] min-w-0 rounded-[20px] rounded-bl-md border p-3";

function Bubble({
  chatId,
  message,
  onCards,
  arriving,
}: {
  chatId: number;
  message: ChatMessage;
  onCards?: (cards: ChatCard[]) => void;
  // New in this visit: it settles in. Messages loaded with the chat don't.
  arriving: boolean;
}) {
  const settle = arriving ? "animate-settle" : "";
  if (message.role === "user") {
    return (
      <div className={`flex justify-end ${settle} origin-bottom-right`}>
        <div className={USER_BUBBLE}>{message.content}</div>
      </div>
    );
  }
  return (
    <div className={`flex justify-start ${settle} origin-bottom-left`}>
      <div
        className={`${REPLY_BUBBLE} ${
          message.failed
            ? "border-danger/30 bg-danger-soft text-danger"
            : "border-line bg-surface"
        }`}
      >
        <div className="px-1">
          {message.failed ? (
            <p className="text-sm">{message.content}</p>
          ) : (
            <Markdown text={message.content} />
          )}
        </div>
        {message.cards.length > 0 && onCards && (
          <Cards chatId={chatId} message={message} onChange={onCards} />
        )}
      </div>
    </div>
  );
}

function ChatList({
  chats,
  activeId,
  search,
  onSearch,
  onNew,
}: {
  chats: ChatSummary[] | null;
  activeId: number | null;
  search: string;
  onSearch: (value: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex gap-2">
        <Input
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search chats"
          type="search"
        />
        <Button onClick={onNew} className="shrink-0">
          <Pencil {...ICON} />
          New
        </Button>
      </div>
      <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
        {chats === null ? (
          <p className="px-2 text-sm text-faint">Loading…</p>
        ) : chats.length === 0 ? (
          <p className="px-2 text-sm text-faint">
            {search ? "No chats match." : "No chats yet."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {chats.map((chat) => (
              <li key={chat.id}>
                <a
                  href={`/chat/${chat.id}`}
                  onClick={(event) => {
                    event.preventDefault();
                    navigate(`/chat/${chat.id}`);
                  }}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-[transform,background-color,color] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100 ${
                    chat.id === activeId
                      ? "bg-accent-soft text-accent-text"
                      : "text-muted hover:bg-hover hover:text-ink"
                  }`}
                >
                  {chat.pinned && (
                    <Pin {...ICON} size={14} aria-label="Pinned" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                  <span className="shrink-0 text-xs text-faint">
                    {shortDate(chat.updatedAt)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const ACCEPT =
  "image/jpeg,image/png,image/webp,.pdf,.pptx,.docx,.txt,.md,.csv,.json,.py,.java,.c,.cpp,.js,.ts,.sql,.tex";

function Composer({
  busy,
  onSend,
}: {
  busy: boolean;
  onSend: (text: string, upload: Upload | null) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [upload, setUpload] = useState<{ name: string; data: Upload } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  // Goes up each time an upload or message is refused: the box shakes.
  const [refused, setRefused] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || (!text.trim() && !upload)) return;
    const sent = await onSend(text, upload?.data ?? null);
    if (sent) {
      setText("");
      setUpload(null);
    } else {
      setRefused((count) => count + 1);
    }
  };

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter starts a new line (phones keep Enter).
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      event.preventDefault();
      void submit();
    }
  };

  return (
    <Shake trigger={refused}>
      <form
        onSubmit={(event) => void submit(event)}
        className={`rounded-2xl border bg-surface p-2 shadow-card transition-[border-color] duration-150 ease-out ${
          error
            ? "border-danger"
            : "border-line-strong focus-within:border-accent"
        }`}
      >
        {upload && (
          // 8 px corners inside the box's 16 px with 8 px padding.
          <div className="mb-2 flex animate-settle items-center gap-2 rounded-lg bg-sunken px-3 py-1.5 text-xs">
            {upload.data.image ? (
              <ImageIcon {...ICON} size={14} />
            ) : (
              <FileText {...ICON} size={14} />
            )}
            <span className="min-w-0 flex-1 truncate">{upload.name}</span>
            <button
              type="button"
              aria-label="Remove attachment"
              className="rounded p-0.5 text-muted transition-[transform,color] duration-150 ease-out hover:text-ink active:scale-[0.97]"
              onClick={() => setUpload(null)}
            >
              <X {...ICON} size={14} />
            </button>
          </div>
        )}
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKey}
          rows={2}
          maxLength={8000}
          placeholder="Ask anything, or tell it to add a to-do, reminder or event…"
          className="block max-h-48 w-full resize-none bg-transparent px-2 py-1 text-sm outline-none placeholder:text-faint"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              setError(null);
              try {
                setUpload({ name: file.name, data: await prepareUpload(file) });
              } catch (failure) {
                setError(errorText(failure));
                setRefused((count) => count + 1);
              }
            }}
          />
          <Button
            type="button"
            variant="ghost"
            onClick={() => fileInput.current?.click()}
            disabled={busy}
          >
            <Paperclip {...ICON} />
            Attach
          </Button>
          <Button type="submit" disabled={busy || (!text.trim() && !upload)}>
            {busy ? "Answering…" : "Send"}
            {!busy && <ArrowUp {...ICON} />}
          </Button>
        </div>
        {error && (
          <div className="mt-2">
            <Notice tone="error">{error}</Notice>
          </div>
        )}
      </form>
    </Shake>
  );
}

export function ChatPage({ path }: { path: string }) {
  const match = /^\/chat\/(\d+)/.exec(path);
  const activeId = match ? Number(match[1]) : null;

  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [search, setSearch] = useState("");
  const [chat, setChat] = useState<ChatSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  // Messages with ids above this arrived during this visit (they settle in).
  const [loadedUpTo, setLoadedUpTo] = useState(Infinity);
  // On a phone the list and a chat swap places: opening a chat slides it in
  // from the right, Back brings the list in from the left.
  const [previousId, setPreviousId] = useState(activeId);
  const [slide, setSlide] = useState<"right" | "left" | null>(null);
  if (previousId !== activeId) {
    setPreviousId(activeId);
    setSlide(
      previousId === null && activeId !== null
        ? "right"
        : previousId !== null && activeId === null
          ? "left"
          : null,
    );
  }
  // A message typed before its chat existed, sent once the chat opens.
  const queued = useRef<{ text: string; upload: Upload | null } | null>(null);

  const loadList = useCallback((query: string) => {
    api<{ chats: ChatSummary[] }>(
      query ? `chats?q=${encodeURIComponent(query)}` : "chats",
    )
      .then((result) => setChats(result.chats))
      .catch(() => setChats([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => loadList(search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [search, loadList]);

  useEffect(() => {
    setLoadError(null);
    setSendError(null);
    setDraft(null);
    setStatus(null);
    if (activeId === null) {
      setChat(null);
      setMessages([]);
      return;
    }
    let cancelled = false;
    api<{ chat: ChatSummary; messages: ChatMessage[] }>(`chats/${activeId}`)
      .then((result) => {
        if (cancelled) return;
        setChat(result.chat);
        setMessages(result.messages);
        setLoadedUpTo(Math.max(0, ...result.messages.map((m) => m.id)));
      })
      .catch((failure) => !cancelled && setLoadError(errorText(failure)));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [messages, draft, pending]);

  const send = useCallback(
    async (chatId: number, text: string, upload: Upload | null) => {
      setBusy(true);
      setSendError(null);
      setPending(text || (upload?.image ? "[Photo]" : "[File]"));
      setStatus("Sending");
      try {
        await sendMessage(chatId, { text, ...(upload ?? {}) }, (event) => {
          if (event.type === "user") {
            setPending(null);
            setMessages((current) => [...current, event.message]);
          } else if (event.type === "status") {
            setStatus(event.text);
          } else if (event.type === "draft") {
            setDraft(event.text || null);
          } else if (event.type === "done") {
            setDraft(null);
            setMessages((current) => [...current, event.message]);
            setChat((current) =>
              current ? { ...current, title: event.title } : current,
            );
          } else if (event.type === "error") {
            setSendError(event.error);
          }
        });
        return true;
      } catch (failure) {
        setSendError(errorText(failure));
        return false;
      } finally {
        setBusy(false);
        setStatus(null);
        setDraft(null);
        setPending(null);
        loadList(search);
      }
    },
    [loadList, search],
  );

  // Send the message typed on the empty page once its new chat has opened.
  useEffect(() => {
    if (activeId !== null && chat?.id === activeId && queued.current) {
      const { text, upload } = queued.current;
      queued.current = null;
      void send(activeId, text, upload);
    }
  }, [activeId, chat, send]);

  const newChat = async (first?: { text: string; upload: Upload | null }) => {
    const { chat: created } = await api<{ chat: ChatSummary }>("chats", {
      method: "POST",
    });
    queued.current = first ?? null;
    navigate(`/chat/${created.id}`);
  };

  const onSend = async (text: string, upload: Upload | null) => {
    if (activeId === null) {
      try {
        await newChat({ text, upload });
        return true;
      } catch (failure) {
        setSendError(errorText(failure));
        return false;
      }
    }
    return send(activeId, text, upload);
  };

  const change = async (body: { title?: string; pinned?: boolean }) => {
    if (!chat) return;
    try {
      await api(`chats/${chat.id}`, { method: "PATCH", body });
      setChat({ ...chat, ...body });
      loadList(search);
    } catch (failure) {
      setSendError(errorText(failure));
    }
  };

  const remove = async () => {
    if (
      !chat ||
      !window.confirm(`Delete "${chat.title}"? This can't be undone.`)
    ) {
      return;
    }
    try {
      await api(`chats/${chat.id}`, { method: "DELETE" });
      navigate("/chat");
      loadList(search);
    } catch (failure) {
      setSendError(errorText(failure));
    }
  };

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] gap-6 md:h-[calc(100dvh-5rem)]">
      <aside
        key={activeId === null ? "list" : "list-hidden"}
        className={`w-full shrink-0 md:block md:w-64 ${activeId === null ? "block" : "hidden"} ${slide === "left" ? "max-md:animate-slide-from-left" : ""}`}
      >
        <ChatList
          chats={chats}
          activeId={activeId}
          search={search}
          onSearch={setSearch}
          onNew={() => void newChat().catch((f) => setSendError(errorText(f)))}
        />
      </aside>

      <section
        key={activeId ?? "none"}
        className={`min-w-0 flex-1 flex-col ${activeId === null ? "hidden md:flex" : "flex"} ${slide === "right" ? "max-md:animate-slide-from-right" : ""}`}
      >
        <header className="flex items-center gap-2 border-b border-line pb-3">
          {activeId !== null && (
            <button
              type="button"
              className="-ml-1 inline-flex items-center rounded-lg py-1 pr-2 text-sm font-medium text-accent-text transition-transform duration-150 ease-out active:scale-[0.97] md:hidden"
              onClick={() => navigate("/chat")}
            >
              <ChevronLeft {...ICON} />
              Chats
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">
            {chat?.title ?? "New chat"}
          </h1>
          {chat && (
            <div className="flex shrink-0 gap-0.5">
              <Tooltip label={chat.pinned ? "Unpin" : "Pin"}>
                <Button
                  variant="ghost"
                  aria-label={chat.pinned ? "Unpin" : "Pin"}
                  onClick={() => void change({ pinned: !chat.pinned })}
                >
                  <SwapIcon
                    show={chat.pinned ? "pinned" : "unpinned"}
                    icons={{
                      unpinned: <Pin {...ICON} />,
                      pinned: <PinOff {...ICON} />,
                    }}
                  />
                </Button>
              </Tooltip>
              <Tooltip label="Rename">
                <Button
                  variant="ghost"
                  aria-label="Rename"
                  onClick={() => {
                    const title = window.prompt("Rename chat", chat.title);
                    if (title?.trim()) void change({ title: title.trim() });
                  }}
                >
                  <Pencil {...ICON} />
                </Button>
              </Tooltip>
              <Tooltip label="Delete">
                <Button
                  variant="ghost"
                  aria-label="Delete"
                  onClick={() => void remove()}
                >
                  <Trash2 {...ICON} />
                </Button>
              </Tooltip>
            </div>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
          {loadError && <Notice tone="error">{loadError}</Notice>}
          {activeId === null && (
            <div className="mx-auto max-w-md animate-settle pt-10 text-center text-sm text-muted">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-text">
                <MessageSquare {...ICON} size={22} />
              </span>
              <p className="mt-3 font-semibold text-ink">
                Ask the assistant anything
              </p>
              <p className="mt-1">
                It's the same assistant as on Telegram: Canvas files and
                deadlines, your calendar, to-dos, reminders and spending.
                Deleting or adding events asks you first.
              </p>
            </div>
          )}
          {chat &&
            messages.map((message) => (
              <Bubble
                key={message.id}
                chatId={chat.id}
                message={message}
                arriving={message.id > loadedUpTo}
                onCards={(cards) =>
                  setMessages((current) =>
                    current.map((m) =>
                      m.id === message.id ? { ...m, cards } : m,
                    ),
                  )
                }
              />
            ))}
          {pending && (
            <div className="flex origin-bottom-right animate-settle justify-end opacity-70">
              <div className={USER_BUBBLE}>{pending}</div>
            </div>
          )}
          {draft && (
            <div className="flex origin-bottom-left animate-settle justify-start">
              <div className={`${REPLY_BUBBLE} border-line bg-surface`}>
                <div className="px-1">
                  <Markdown text={draft} />
                </div>
              </div>
            </div>
          )}
          {busy && status && !draft && (
            <p className="animate-pulse text-sm text-muted">{status}…</p>
          )}
          {sendError && <Notice tone="error">{sendError}</Notice>}
          <div ref={bottom} />
        </div>

        <Composer busy={busy} onSend={onSend} />
      </section>
    </div>
  );
}
